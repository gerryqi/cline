import type { AgentEvent } from "@cline/agents";
import {
	prewarmFileIndex,
	SessionSource,
	type UserInstructionConfigWatcher,
} from "@cline/core/server";
import type { providers } from "@cline/llms";
import { askQuestionInTerminal, requestToolApproval } from "../utils/approval";
import { handleEvent, handleTeamEvent } from "../utils/events";
import { createRuntimeHooks } from "../utils/hooks";
import {
	c,
	emitJsonLine,
	formatUsd,
	getActiveCliSession,
	setActiveCliSession,
	writeErr,
	writeln,
} from "../utils/output";
import { createDefaultCliSessionManager } from "../utils/session";
import type { Config } from "../utils/types";
import { setActiveRuntimeAbort } from "./active-runtime";
import { resolveClineWelcomeLine } from "./interactive-welcome";
import { buildUserInputMessage } from "./prompt";
import { subscribeToAgentEvents } from "./session-events";

function printModelProviderInfo(config: Config): void {
	const modelSource = config.knownModels ? "live" : "bundled";
	const thinkingStatus = config.thinking ? "on" : "off";
	const mode = config.mode;
	if (config.outputMode === "json") {
		emitJsonLine("stdout", {
			type: "run_start",
			providerId: config.providerId,
			modelId: config.modelId,
			catalog: modelSource,
			thinking: thinkingStatus,
			mode,
			sessionId: getActiveCliSession()?.manifest.session_id,
		});
		return;
	}
	writeln(
		`${c.dim}[model] provider=${config.providerId} model=${config.modelId} catalog=${modelSource} thinking=${thinkingStatus} mode=${mode}${c.reset}\n`,
	);
}

export async function runAgent(
	prompt: string,
	config: Config,
	userInstructionWatcher?: UserInstructionConfigWatcher,
	options?: {
		clineApiBaseUrl?: string;
		clineProviderSettings?: providers.ProviderSettings;
	},
): Promise<void> {
	const clineWelcomeLine = await resolveClineWelcomeLine({
		config,
		clineApiBaseUrl: options?.clineApiBaseUrl,
		clineProviderSettings: options?.clineProviderSettings,
	});
	if (clineWelcomeLine) {
		writeln(clineWelcomeLine);
	}
	const startTime = performance.now();
	void prewarmFileIndex(config.cwd);
	const hooks = createRuntimeHooks();
	const sessionManager = await createDefaultCliSessionManager({
		defaultToolExecutors: {
			askQuestion: askQuestionInTerminal,
		},
		toolPolicies: config.toolPolicies,
		requestToolApproval,
	});

	let errorAlreadyReported = false;
	let reasoningChunkCount = 0;
	let redactedReasoningChunkCount = 0;
	const onAgentEvent = (event: AgentEvent) => {
		if (event.type === "error") {
			errorAlreadyReported = true;
		}
		if (event.type === "content_start" && event.contentType === "reasoning") {
			reasoningChunkCount += 1;
			if (event.redacted) {
				redactedReasoningChunkCount += 1;
			}
		}
		handleEvent(event, config);
	};
	const unsubscribe = subscribeToAgentEvents(sessionManager, onAgentEvent);
	let abortRequested = false;
	let activeSessionId: string | undefined;
	const abortAll = () => {
		if (abortRequested) {
			return false;
		}
		abortRequested = true;
		if (activeSessionId) {
			void sessionManager.abort(activeSessionId);
		}
		return true;
	};
	setActiveRuntimeAbort(abortAll);
	const handleSigint = () => {
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
	};
	const handleSigterm = () => {
		if (abortAll() && config.outputMode === "json") {
			emitJsonLine("stdout", {
				type: "run_abort_requested",
				reason: "sigterm",
			});
		}
	};
	process.on("SIGINT", handleSigint);
	process.on("SIGTERM", handleSigterm);

	let runFailed = false;
	try {
		printModelProviderInfo(config);
		const userInput = await buildUserInputMessage(
			prompt,
			userInstructionWatcher,
		);
		const started = await sessionManager.start({
			source: SessionSource.CLI,
			config: {
				...config,
				hooks,
				onTeamEvent: handleTeamEvent,
			},
			prompt,
			interactive: false,
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
		activeSessionId = started.sessionId;
		setActiveCliSession({
			manifestPath: started.manifestPath,
			transcriptPath: started.transcriptPath,
			hookPath: started.hookPath,
			messagesPath: started.messagesPath,
			manifest: started.manifest,
		});
		const result = await sessionManager.send({
			sessionId: started.sessionId,
			prompt: userInput,
		});
		if (!result) {
			throw new Error("session manager did not return a result");
		}
		if (config.outputMode === "json") {
			emitJsonLine("stdout", {
				type: "run_result",
				finishReason: result.finishReason,
				iterations: result.iterations,
				usage: result.usage,
				durationMs: result.durationMs,
				text: result.text,
				model: result.model,
			});
		}
		if (abortRequested || result.finishReason === "aborted") {
			writeln();
			return;
		}

		if (config.outputMode === "text") {
			writeln();
		}

		if (
			config.outputMode === "text" &&
			(config.showTimings || config.showUsage)
		) {
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
		if (config.outputMode === "text" && config.thinking) {
			writeln(
				`${c.dim}[thinking] chunks=${reasoningChunkCount} redacted=${redactedReasoningChunkCount}${c.reset}`,
			);
		}
	} catch (err) {
		runFailed = true;
		if (config.outputMode === "text") {
			writeln();
		}
		if (!errorAlreadyReported) {
			writeErr(err instanceof Error ? err.message : String(err));
		}
		process.exitCode = 1;
	} finally {
		process.off("SIGINT", handleSigint);
		process.off("SIGTERM", handleSigterm);
		unsubscribe();
		try {
			if (activeSessionId) {
				await sessionManager.stop(activeSessionId);
			}
		} finally {
			await sessionManager.dispose("cli_run_shutdown");
		}
		setActiveRuntimeAbort(undefined);
	}
	if (runFailed) {
		return;
	}
}
