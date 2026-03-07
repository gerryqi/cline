import { createInterface } from "node:readline";
import type { AgentEvent } from "@cline/agents";
import {
	prewarmFileIndex,
	SessionSource,
	type UserInstructionConfigWatcher,
} from "@cline/core/server";
import type { providers } from "@cline/llms";
import { askQuestionInTerminal, requestToolApproval } from "../approval";
import { handleEvent, handleTeamEvent } from "../events";
import { createRuntimeHooks } from "../utils/hooks";
import {
	c,
	emitJsonLine,
	formatUsd,
	setActiveCliSession,
	writeErr,
	writeln,
} from "../utils/output";
import { loadInteractiveResumeMessages } from "../utils/resume";
import { createDefaultCliSessionManager } from "../utils/session";
import type { Config } from "../utils/types";
import { setActiveRuntimeAbort } from "./active-runtime";
import { resolveClineWelcomeLine } from "./interactive-welcome";
import { buildUserInputMessage } from "./prompt";
import { subscribeToAgentEvents } from "./session-events";

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

	const clineWelcomeLine = await resolveClineWelcomeLine({
		config,
		clineApiBaseUrl: options?.clineApiBaseUrl,
		clineProviderSettings: options?.clineProviderSettings,
	});
	if (clineWelcomeLine) {
		writeln(clineWelcomeLine);
	}

	writeln(
		`${c.cyan}${config.providerId}${c.reset} ${c.dim}${config.modelId}${c.reset}`,
	);
	writeln(`${c.dim}Type your message. Press Ctrl+C to exit.${c.reset}`);
	writeln();
	void prewarmFileIndex(config.cwd);

	const rl = createInterface({
		input: process.stdin,
		output: process.stdout,
		prompt: `${c.green}>${c.reset} `,
	});
	const hooks = createRuntimeHooks();
	const sessionManager = await createDefaultCliSessionManager({
		defaultToolExecutors: {
			askQuestion: askQuestionInTerminal,
		},
		toolPolicies: config.toolPolicies,
		requestToolApproval,
	});

	let turnErrorReported = false;
	const onAgentEvent = (event: AgentEvent) => {
		if (event.type === "error") {
			turnErrorReported = true;
		}
		handleEvent(event, config);
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
			onTeamEvent: handleTeamEvent,
		},
		interactive: true,
		initialMessages,
		userInstructionWatcher,
		onTeamRestored: () => {
			if (config.outputMode === "json") {
				emitJsonLine("stdout", {
					type: "team_restored",
					teamName: config.teamName ?? "(unknown team)",
				});
				return;
			}
			writeln(
				`${c.dim}[team] restored persisted team state for "${config.teamName ?? "(unknown team)"}"${c.reset}`,
			);
		},
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
	const handleSigint = () => {
		if (isRunning) {
			if (abortAll()) {
				if (config.outputMode === "json") {
					emitJsonLine("stdout", {
						type: "run_abort_requested",
						reason: "sigint",
					});
					return;
				}
				writeln(`\n${c.dim}[abort] requested${c.reset}`);
			}
			return;
		}
		if (process.stdin.isTTY) {
			rl.close();
			return;
		}
		writeln(`\n${c.dim}[abort] no active run${c.reset}`);
		rl.prompt();
	};
	const handleSigterm = () => {
		if (isRunning) {
			if (abortAll() && config.outputMode === "json") {
				emitJsonLine("stdout", {
					type: "run_abort_requested",
					reason: "sigterm",
				});
			}
			return;
		}
		rl.close();
	};

	process.on("SIGINT", handleSigint);
	process.on("SIGTERM", handleSigterm);

	rl.prompt();

	rl.on("line", async (line) => {
		const input = line.trim();
		if (!input) {
			rl.prompt();
			return;
		}

		if (isRunning) {
			return;
		}

		isRunning = true;
		abortRequested = false;
		turnErrorReported = false;
		rl.pause();

		try {
			writeln();
			const startTime = performance.now();

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

			writeln();

			if (config.showTimings || config.showUsage) {
				const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
				const parts: string[] = [];
				if (config.showTimings) {
					parts.push(`${elapsed}s`);
				}
				if (config.showUsage) {
					const tokens = result.usage.inputTokens + result.usage.outputTokens;
					parts.push(`${tokens} tokens`);
					if (typeof result.usage.totalCost === "number") {
						parts.push(`${formatUsd(result.usage.totalCost)} est. cost`);
					}
					if (result.iterations > 1) {
						parts.push(`${result.iterations} iterations`);
					}
				}
				writeln(`${c.dim}[${parts.join(" | ")}]${c.reset}`);
			}

			writeln();
		} catch (err) {
			writeln();
			if (!turnErrorReported) {
				writeErr(err instanceof Error ? err.message : String(err));
			}
			writeln();
		} finally {
			isRunning = false;
			rl.resume();
			rl.prompt();
		}
	});

	rl.on("close", () => {
		void (async () => {
			process.off("SIGINT", handleSigint);
			process.off("SIGTERM", handleSigterm);
			unsubscribe();
			try {
				await sessionManager.stop(activeSessionId);
			} finally {
				await sessionManager.dispose("cli_interactive_shutdown");
			}
			setActiveRuntimeAbort(undefined);
			writeln();
			process.exit(0);
		})();
	});
}
