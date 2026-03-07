import { EventEmitter } from "node:events";
import type { AgentEvent, TeamEvent } from "@cline/agents";
import {
	prewarmFileIndex,
	SessionSource,
	type UserInstructionConfigWatcher,
} from "@cline/core/server";
import type { providers } from "@cline/llms";
import { render } from "ink";
import React from "react";
import { askQuestionInTerminal, requestToolApproval } from "../approval";
import { InteractiveTui } from "../tui/interactive-tui";
import { createRuntimeHooks } from "../utils/hooks";
import { setActiveCliSession, writeErr } from "../utils/output";
import { loadInteractiveResumeMessages } from "../utils/resume";
import { createDefaultCliSessionManager } from "../utils/session";
import type { Config } from "../utils/types";
import { setActiveRuntimeAbort } from "./active-runtime";
import {
	listInteractiveSlashCommands,
	resolveClineWelcomeLine,
} from "./interactive-welcome";
import { buildUserInputMessage } from "./prompt";
import { subscribeToAgentEvents } from "./session-events";

interface InteractiveEventBridge {
	on(event: "agent", listener: (event: AgentEvent) => void): this;
	on(event: "team", listener: (event: TeamEvent) => void): this;
	off(event: "agent", listener: (event: AgentEvent) => void): this;
	off(event: "team", listener: (event: TeamEvent) => void): this;
	emit(event: "agent", payload: AgentEvent): boolean;
	emit(event: "team", payload: TeamEvent): boolean;
}

export async function runInteractive(
	config: Config,
	userInstructionWatcher?: UserInstructionConfigWatcher,
	resumeSessionId?: string,
	options?: {
		clineApiBaseUrl?: string;
		clineProviderSettings?: providers.ProviderSettings;
	},
): Promise<void> {
	if (config.outputMode === "json") {
		writeErr("interactive mode is not supported with --output json");
		process.exit(1);
	}
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		writeErr(
			"interactive mode requires a TTY (stdin/stdout must both be terminals)",
		);
		process.exit(1);
	}

	const clineWelcomeLine = await resolveClineWelcomeLine({
		config,
		clineApiBaseUrl: options?.clineApiBaseUrl,
		clineProviderSettings: options?.clineProviderSettings,
	});
	void prewarmFileIndex(config.cwd);
	const workflowSlashCommands = listInteractiveSlashCommands(
		userInstructionWatcher,
	);

	const hooks = createRuntimeHooks();
	const autoApproveAllRef = {
		current: config.toolPolicies["*"]?.autoApprove !== false,
	};
	const sessionManager = await createDefaultCliSessionManager({
		defaultToolExecutors: {
			askQuestion: askQuestionInTerminal,
		},
		toolPolicies: config.toolPolicies,
		requestToolApproval: async (request) => {
			if (autoApproveAllRef.current) {
				return { approved: true };
			}
			return requestToolApproval(request);
		},
	});

	const uiEvents = new EventEmitter() as InteractiveEventBridge;

	const onAgentEvent = (event: AgentEvent) => {
		uiEvents.emit("agent", event);
	};
	const unsubscribe = subscribeToAgentEvents(sessionManager, onAgentEvent);

	const initialMessages = await loadInteractiveResumeMessages(
		sessionManager,
		resumeSessionId,
	);
	const started = await sessionManager.start({
		source: SessionSource.CLI,
		config: {
			...config,
			hooks,
			onTeamEvent: (event) => {
				uiEvents.emit("team", event);
			},
		},
		interactive: true,
		initialMessages,
		userInstructionWatcher,
		onTeamRestored: () => {},
	});
	setActiveCliSession({
		manifestPath: started.manifestPath,
		transcriptPath: started.transcriptPath,
		hookPath: started.hookPath,
		messagesPath: started.messagesPath,
		manifest: started.manifest,
	});
	const activeSessionId = started.sessionId;

	let isRunning = false;
	let abortRequested = false;
	const abortAll = () => {
		if (abortRequested) {
			return false;
		}
		abortRequested = true;
		void sessionManager.abort(activeSessionId);
		return true;
	};
	setActiveRuntimeAbort(abortAll);

	let unmountInteractiveUi: (() => void) | undefined;
	const requestExit = () => {
		if (!unmountInteractiveUi) {
			return;
		}
		const close = unmountInteractiveUi;
		unmountInteractiveUi = undefined;
		close();
	};

	const handleSigint = () => {
		if (isRunning) {
			abortAll();
			return;
		}
		requestExit();
	};
	const handleSigterm = () => {
		if (isRunning) {
			abortAll();
			return;
		}
		requestExit();
	};

	process.on("SIGINT", handleSigint);
	process.on("SIGTERM", handleSigterm);

	const inkApp = render(
		React.createElement(InteractiveTui, {
			config,
			welcomeLine: clineWelcomeLine ?? undefined,
			workflowSlashCommands,
			subscribeToEvents: ({ onAgentEvent: onAgent, onTeamEvent: onTeam }) => {
				uiEvents.on("agent", onAgent);
				uiEvents.on("team", onTeam);
				return () => {
					uiEvents.off("agent", onAgent);
					uiEvents.off("team", onTeam);
				};
			},
			onSubmit: async (input, _mode) => {
				abortRequested = false;
				isRunning = true;
				try {
					const userInput = await buildUserInputMessage(
						input,
						userInstructionWatcher,
					);
					const result = await sessionManager.send({
						sessionId: activeSessionId,
						prompt: userInput,
					});
					if (!result) {
						throw new Error("session manager did not return a result");
					}
					return {
						usage: result.usage,
						iterations: result.iterations,
					};
				} finally {
					isRunning = false;
				}
			},
			onAbort: () => {
				abortAll();
			},
			onExit: requestExit,
			onRunningChange: (running) => {
				isRunning = running;
			},
			onTurnErrorReported: () => {
				// Interactive TUI handles turn-scoped error rendering.
			},
			onAutoApproveChange: (enabled) => {
				autoApproveAllRef.current = enabled;
			},
		}),
		{ exitOnCtrlC: false },
	);
	unmountInteractiveUi = () => {
		try {
			inkApp.unmount();
		} catch {
			// no-op: already unmounted
		}
	};

	try {
		await inkApp.waitUntilExit();
	} finally {
		process.off("SIGINT", handleSigint);
		process.off("SIGTERM", handleSigterm);
		unsubscribe();
		try {
			await sessionManager.stop(activeSessionId);
		} finally {
			await sessionManager.dispose("cli_interactive_shutdown");
		}
		setActiveRuntimeAbort(undefined);
	}
}
