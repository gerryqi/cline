#!/usr/bin/env -S node --no-deprecation

/**
 * @cline/cli - Fast CLI for running agentic loops
 *
 * A lightweight, speed-focused CLI for interacting with AI agents.
 * Streams responses in real-time with minimal latency.
 *
 * Usage:
 *   agent "your prompt here"
 *   agent -s "system prompt" "your prompt"
 *   agent -i                           # interactive mode
 *   echo "prompt" | agent              # pipe input
 */

import {
	appendFileSync,
	existsSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { createInterface } from "node:readline";
import {
	Agent,
	type AgentEvent,
	type AgentHooks,
	type AgentResult,
	createBuiltinTools,
	createSpawnAgentTool as createSdkSpawnAgentTool,
	createSubprocessHooks,
	type HookEventPayload,
	type RunHookResult,
	type TeamEvent,
	type Tool,
	type ToolApprovalRequest,
	type ToolApprovalResult,
	type ToolPolicy,
	ToolPresets,
} from "@cline/agents";
import {
	createTeamName,
	createUserInstructionConfigWatcher,
	DefaultRuntimeBuilder,
	loadRulesForSystemPromptFromWatcher,
	migrateLegacyProviderSettings,
	ProviderSettingsManager,
	prewarmFileIndex,
	type SessionManifest,
	SessionSource,
	type UserInstructionConfigWatcher,
} from "@cline/core/server";
import { providers } from "@cline/llms";
import { version } from "../package.json";
import {
	ensureOAuthProviderApiKey,
	getPersistedProviderApiKey,
	isOAuthProvider,
	normalizeAuthProviderId,
	normalizeProviderId,
	runAuthProviderCommand,
} from "./commands/auth";
import { formatHookDispatchOutput, runHookCommand } from "./commands/hook";
import {
	type HistorySessionRow,
	runHistoryListCommand,
	runListCommand,
} from "./commands/list";
import { runRpcStartCommand } from "./commands/rpc";
import {
	buildDefaultSystemPrompt,
	buildUserInputMessage,
} from "./runtime/prompt";
import {
	configureSandboxEnvironment,
	formatToolInput,
	formatToolOutput,
	nowIso,
	parseArgs,
	resolveWorkspaceRoot,
	truncate,
} from "./utils/helpers";
import {
	createRootCliSessionWithArtifacts,
	deleteCliSession,
	handleSubAgentEnd,
	handleSubAgentStart,
	listCliSessions,
	onTeamTaskEnd,
	onTeamTaskStart,
	updateCliSessionStatusInStore,
	writeCliSessionManifest,
} from "./utils/session";
import type { ActiveCliSession, CliOutputMode, Config } from "./utils/types";

let activeCliSession: ActiveCliSession | undefined;
let cliSessionExitBound = false;
let activeRuntimeAbort: ((reason: string) => void) | undefined;
let streamErrorGuardsBound = false;
let activeInlineStream: "text" | "reasoning" | undefined;
let inlineStreamHasOutput = false;

function isBrokenPipeError(error: unknown): boolean {
	return Boolean(
		error &&
			typeof error === "object" &&
			"code" in error &&
			typeof (error as { code?: unknown }).code === "string" &&
			(error as { code: string }).code === "EPIPE",
	);
}

function installStreamErrorGuards(): void {
	if (streamErrorGuardsBound) {
		return;
	}
	streamErrorGuardsBound = true;

	const onStdoutError = (error: unknown) => {
		if (isBrokenPipeError(error)) {
			process.exit(0);
		}
	};
	const onStderrError = (error: unknown) => {
		if (isBrokenPipeError(error)) {
			process.exit(0);
		}
	};

	process.stdout.on("error", onStdoutError);
	process.stderr.on("error", onStderrError);
}

function setActiveRuntimeAbort(
	abortFn: ((reason: string) => void) | undefined,
): void {
	activeRuntimeAbort = abortFn;
}

function abortActiveRuntime(reason: string): void {
	try {
		activeRuntimeAbort?.(reason);
	} catch {
		// Best-effort abort path.
	}
}

function persistApiMessages(messages: AgentResult["messages"]): void {
	if (!activeCliSession) {
		return;
	}
	writeFileSync(
		activeCliSession.messagesPath,
		`${JSON.stringify(
			{
				version: 1,
				updated_at: nowIso(),
				messages,
			},
			null,
			2,
		)}\n`,
		"utf8",
	);
}

function persistCurrentAgentMessages(agent: Agent): void {
	try {
		persistApiMessages(agent.getMessages());
	} catch {
		// Best-effort persistence path for interrupted/failed runs.
	}
}

async function createCliSession(
	config: Config,
	prompt: string | undefined,
	interactive: boolean,
): Promise<ActiveCliSession> {
	const sessionId = process.env.CLINE_SESSION_ID?.trim() || "";
	const created = await createRootCliSessionWithArtifacts({
		sessionId,
		source: SessionSource.CLI,
		pid: process.pid,
		interactive,
		provider: config.providerId,
		model: config.modelId,
		cwd: config.cwd,
		workspaceRoot: config.workspaceRoot || config.cwd,
		teamName: config.teamName,
		enableTools: config.enableTools,
		enableSpawn: config.enableSpawnAgent,
		enableTeams: config.enableAgentTeams,
		prompt: prompt?.trim() || undefined,
		startedAt: nowIso(),
	});
	process.env.CLINE_SESSION_ID = created.env.CLINE_SESSION_ID;
	process.env.CLINE_HOOKS_LOG_PATH = created.env.CLINE_HOOKS_LOG_PATH;
	process.env.CLINE_ENABLE_SUBPROCESS_HOOKS =
		created.env.CLINE_ENABLE_SUBPROCESS_HOOKS;

	return {
		manifestPath: created.manifestPath,
		transcriptPath: created.transcriptPath,
		hookPath: created.hookPath,
		messagesPath: created.messagesPath,
		manifest: created.manifest,
	};
}

async function updateCliSessionStatus(
	status: SessionManifest["status"],
	exitCode?: number | null,
): Promise<void> {
	if (!activeCliSession) {
		return;
	}
	const result = await updateCliSessionStatusInStore(
		activeCliSession.manifest.session_id,
		status,
		exitCode,
	);
	if (!result.updated) {
		return;
	}
	const endedAt = result.endedAt ?? nowIso();
	activeCliSession.manifest.status = status;
	activeCliSession.manifest.ended_at = endedAt;
	activeCliSession.manifest.exit_code = exitCode ?? undefined;
	await writeCliSessionManifest(
		activeCliSession.manifestPath,
		activeCliSession.manifest,
	);
}

function bindCliSessionExitHandlers(): void {
	if (cliSessionExitBound) {
		return;
	}
	cliSessionExitBound = true;
	process.on("exit", (code) => {
		if (activeCliSession?.manifest.status === "running") {
			void updateCliSessionStatus(code === 0 ? "completed" : "failed", code);
		}
	});
	process.on("SIGTERM", () => {
		abortActiveRuntime("sigterm");
		if (activeCliSession?.manifest.status === "running") {
			void updateCliSessionStatus("cancelled", null);
		}
		process.exit(143);
	});
	process.on("SIGINT", () => {
		abortActiveRuntime("sigint");
		if (activeCliSession?.manifest.status === "running") {
			void updateCliSessionStatus("cancelled", null);
		}
	});
}

// =============================================================================
// ANSI Colors (no dependencies for speed)
// =============================================================================

const c = {
	reset: "\x1b[0m",
	dim: "\x1b[2m",
	bold: "\x1b[1m",
	cyan: "\x1b[36m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	red: "\x1b[31m",
	gray: "\x1b[90m",
};

let currentOutputMode: CliOutputMode = "text";

function jsonReplacer(_key: string, value: unknown): unknown {
	if (value instanceof Error) {
		return {
			name: value.name,
			message: value.message,
			stack: value.stack,
		};
	}
	if (typeof value === "bigint") {
		return value.toString();
	}
	return value;
}

function emitJsonLine(
	stream: "stdout" | "stderr",
	record: Record<string, unknown>,
): void {
	const line = `${JSON.stringify(
		{
			ts: nowIso(),
			...record,
		},
		jsonReplacer,
	)}\n`;
	try {
		if (stream === "stdout") {
			process.stdout.write(line);
		} else {
			process.stderr.write(line);
		}
	} catch (error) {
		if (!isBrokenPipeError(error)) {
			throw error;
		}
	}
	if (activeCliSession) {
		try {
			appendFileSync(activeCliSession.transcriptPath, line, "utf8");
		} catch {
			// Best-effort transcript persistence for desktop discovery.
		}
	}
}

function mergeToolPolicies(
	base: Record<string, ToolPolicy>,
	overrides: Record<string, ToolPolicy>,
): Record<string, ToolPolicy> {
	const out: Record<string, ToolPolicy> = { ...base };
	for (const [name, policy] of Object.entries(overrides)) {
		out[name] = { ...(out[name] ?? {}), ...policy };
	}
	return out;
}

let cachedDesktopApprovalRequester:
	| Promise<(request: ToolApprovalRequest) => Promise<ToolApprovalResult>>
	| undefined;

async function requestDesktopToolApprovalFromCore(
	request: ToolApprovalRequest,
): Promise<ToolApprovalResult> {
	if (!cachedDesktopApprovalRequester) {
		cachedDesktopApprovalRequester = import("@cline/core/server")
			.then((module) => {
				const fn = (
					module as {
						requestDesktopToolApproval?: (
							request: ToolApprovalRequest,
						) => Promise<ToolApprovalResult>;
					}
				).requestDesktopToolApproval;
				if (typeof fn !== "function") {
					throw new Error(
						"Installed @cline/core does not expose requestDesktopToolApproval",
					);
				}
				return fn;
			})
			.catch(() => {
				return async () => ({
					approved: false,
					reason: "Desktop tool approval IPC is not available",
				});
			});
	}
	const requester = await cachedDesktopApprovalRequester;
	return requester(request);
}

async function requestTerminalToolApproval(
	request: ToolApprovalRequest,
): Promise<ToolApprovalResult> {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		return {
			approved: false,
			reason: `Tool "${request.toolName}" requires approval in a TTY session`,
		};
	}
	const preview = truncate(JSON.stringify(request.input), 160);
	const answer = await new Promise<string>((resolve) => {
		const rl = createInterface({
			input: process.stdin,
			output: process.stdout,
		});
		rl.question(
			`\n${c.yellow}Approve ${c.green}"${request.toolName}" ${c.dim}${preview} ${c.reset}[y/N] `,
			(value) => {
				rl.close();
				resolve(value);
			},
		);
	});
	const normalized = answer.trim().toLowerCase();
	if (normalized === "y" || normalized === "yes") {
		return { approved: true };
	}
	return {
		approved: false,
		reason: `Tool "${request.toolName}" was denied by user`,
	};
}

async function requestToolApproval(
	request: ToolApprovalRequest,
): Promise<ToolApprovalResult> {
	const mode = process.env.CLINE_TOOL_APPROVAL_MODE?.trim().toLowerCase();
	if (mode === "desktop") {
		return requestDesktopToolApprovalFromCore(request);
	}
	return requestTerminalToolApproval(request);
}

async function askQuestionInTerminal(
	question: string,
	options: string[],
): Promise<string> {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		return options[0] ?? "";
	}

	return new Promise<string>((resolve) => {
		const rl = createInterface({
			input: process.stdin,
			output: process.stdout,
		});

		write(`\n${c.dim}[follow-up]${c.reset} ${question}\n`);
		for (const [index, option] of options.entries()) {
			write(`${c.dim}  ${index + 1}.${c.reset} ${option}\n`);
		}

		rl.question(
			`${c.dim}Choose 1-${options.length} or type a custom answer:${c.reset} `,
			(value) => {
				rl.close();
				const trimmed = value.trim();
				const numeric = Number.parseInt(trimmed, 10);
				if (
					Number.isInteger(numeric) &&
					numeric >= 1 &&
					numeric <= options.length
				) {
					resolve(options[numeric - 1] ?? "");
					return;
				}
				if (trimmed.length > 0) {
					resolve(trimmed);
					return;
				}
				resolve(options[0] ?? "");
			},
		);
	});
}

function getHookCommand(): string[] | undefined {
	if (process.env.CLINE_ENABLE_SUBPROCESS_HOOKS !== "1" || !process.argv[1]) {
		return undefined;
	}
	return [process.execPath, process.argv[1], "hook"];
}

function writeHookInvocation(
	payload: HookEventPayload,
	result?: RunHookResult,
): void {
	if (currentOutputMode === "json") {
		emitJsonLine("stdout", {
			type: "hook_event",
			hookEventName: payload.hookName,
			hookOutput: result?.parsedJson,
			agentId: payload.agent_id,
			taskId: payload.taskId,
			parentAgentId: payload.parent_agent_id,
		});
		return;
	}
	closeInlineStreamIfNeeded();
	const hookName = payload.hookName;
	const toolName =
		payload.hookName === "tool_call"
			? payload.tool_call.name
			: payload.hookName === "tool_result"
				? payload.tool_result.name
				: undefined;
	const details = toolName ? ` ${c.cyan}${toolName}${c.reset}` : "";
	const output = formatHookDispatchOutput(result);
	if (output) {
		write(
			`\n${c.dim}[hook:${hookName}]${c.reset}${details} ${c.dim}-> ${output}${c.reset}\n`,
		);
		return;
	}
	if (details) {
		write(`\n${c.dim}[hook:${hookName}]${c.reset}${details}\n`);
	}
}

function createRuntimeHooks(): AgentHooks | undefined {
	const command = getHookCommand();
	if (!command) {
		return undefined;
	}
	return createSubprocessHooks({
		command,
		env: process.env,
		cwd: process.cwd(),
		onDispatchError: (error: Error) => {
			if (isDev) {
				writeErr(`hook dispatch failed: ${error.message}`);
			}
		},
		onDispatch: ({ payload, result }) => {
			writeHookInvocation(payload, result);
		},
	}).hooks;
}

function createBuiltinToolsList(cwd: string, mode: Config["mode"]): Tool[] {
	const preset =
		mode === "plan" ? ToolPresets.readonly : ToolPresets.development;
	return createBuiltinTools({
		cwd,
		...preset,
		executors: {
			askQuestion: askQuestionInTerminal,
		},
	});
}

function createCliSpawnTool(
	config: Config,
	hooks: AgentHooks | undefined,
): Tool {
	return createSdkSpawnAgentTool({
		providerId: config.providerId,
		modelId: config.modelId,
		apiKey: config.apiKey,
		baseUrl: config.baseUrl,
		knownModels: config.knownModels,
		defaultMaxIterations: 5,
		createSubAgentTools: () => createBuiltinToolsList(config.cwd, config.mode),
		hooks,
		toolPolicies: config.toolPolicies,
		requestToolApproval,
		onSubAgentStart: ({ subAgentId, conversationId, parentAgentId, input }) => {
			void handleSubAgentStart({
				subAgentId,
				conversationId,
				parentAgentId,
				input,
			});
		},
		onSubAgentEnd: ({
			subAgentId,
			conversationId,
			parentAgentId,
			input,
			result,
			error,
		}) => {
			void handleSubAgentEnd({
				subAgentId,
				conversationId,
				parentAgentId,
				input,
				result,
				error,
			});
		},
	}) as Tool;
}

// =============================================================================
// CLI Output
// =============================================================================

function write(text: string): void {
	try {
		process.stdout.write(text);
	} catch (error) {
		if (!isBrokenPipeError(error)) {
			throw error;
		}
	}
	if (activeCliSession) {
		try {
			appendFileSync(activeCliSession.transcriptPath, text, "utf8");
		} catch {
			// Best-effort transcript persistence for desktop discovery.
		}
	}
}

function writeln(text = ""): void {
	if (currentOutputMode === "json" && text.length === 0) {
		return;
	}
	write(`${text}\n`);
}

function writeErr(text: string): void {
	if (currentOutputMode === "json") {
		emitJsonLine("stderr", { type: "error", message: text });
		return;
	}
	console.error(`${c.red}error:${c.reset} ${text}`);
	if (activeCliSession) {
		try {
			appendFileSync(
				activeCliSession.transcriptPath,
				`error: ${text}\n`,
				"utf8",
			);
		} catch {
			// Best-effort transcript persistence for desktop discovery.
		}
	}
}

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
			sessionId: activeCliSession?.manifest.session_id,
		});
		return;
	}
	writeln(
		`${c.dim}[model] provider=${config.providerId} model=${config.modelId} catalog=${modelSource} thinking=${thinkingStatus} mode=${mode}${c.reset}\n`,
	);
}

function closeInlineStreamIfNeeded(): void {
	if (!inlineStreamHasOutput) {
		return;
	}
	write("\n");
	activeInlineStream = undefined;
	inlineStreamHasOutput = false;
}

function parsePersistedMessages(raw: string): providers.Message[] {
	if (!raw.trim()) {
		return [];
	}
	const parsed = JSON.parse(raw) as { messages?: unknown } | unknown[];
	const messages = Array.isArray(parsed)
		? parsed
		: Array.isArray((parsed as { messages?: unknown })?.messages)
			? ((parsed as { messages: unknown[] }).messages ?? [])
			: [];
	return messages as providers.Message[];
}

async function loadSessionMessages(
	sessionId: string,
): Promise<providers.Message[]> {
	const target = sessionId.trim();
	if (!target) {
		throw new Error("--session requires <id>");
	}
	const rows = (await listCliSessions(2000)) as HistorySessionRow[];
	const row = rows.find((item) => item.session_id === target);
	if (!row) {
		throw new Error(`could not find session "${target}"`);
	}
	const messagesPath = row.messages_path?.trim();
	if (!messagesPath || !existsSync(messagesPath)) {
		return [];
	}
	try {
		return parsePersistedMessages(readFileSync(messagesPath, "utf8"));
	} catch {
		return [];
	}
}

function hydrateAgentMessages(
	agent: Agent,
	messages: providers.Message[],
): void {
	if (messages.length === 0) {
		return;
	}
	// Agent does not expose a public restore API yet; hydrate internal buffer to resume chat context.
	(agent as unknown as { messages: providers.Message[] }).messages = [
		...messages,
	];
}

// =============================================================================
// Agent Runner
// =============================================================================

async function runAgent(
	prompt: string,
	config: Config,
	userInstructionWatcher?: UserInstructionConfigWatcher,
): Promise<void> {
	const startTime = performance.now();
	void prewarmFileIndex(config.cwd);
	const hooks = createRuntimeHooks();
	const runtime = new DefaultRuntimeBuilder().build({
		config,
		hooks,
		onTeamEvent: handleTeamEvent,
		createSpawnTool: () => createCliSpawnTool(config, hooks),
		defaultToolExecutors: {
			askQuestion: askQuestionInTerminal,
		},
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
	const { tools } = runtime;

	let agent: Agent;
	let errorAlreadyReported = false;
	let reasoningChunkCount = 0;
	let redactedReasoningChunkCount = 0;
	const onEvent = (event: AgentEvent) => {
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
		if ((event.type === "iteration_end" || event.type === "done") && agent) {
			persistCurrentAgentMessages(agent);
		}
	};
	agent = new Agent({
		providerId: config.providerId,
		modelId: config.modelId,
		apiKey: config.apiKey,
		baseUrl: config.baseUrl,
		knownModels: config.knownModels,
		thinking: config.thinking,
		systemPrompt: config.systemPrompt,
		tools,
		maxIterations: config.maxIterations,
		onEvent,
		hooks,
		toolPolicies: config.toolPolicies,
		requestToolApproval,
	});
	let abortRequested = false;
	const abortAll = (reason: string) => {
		if (abortRequested) {
			return false;
		}
		abortRequested = true;
		agent.abort();
		runtime.shutdown(reason);
		return true;
	};
	setActiveRuntimeAbort(abortAll);
	const handleSigint = () => {
		if (abortAll("sigint")) {
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
	process.on("SIGINT", handleSigint);

	try {
		printModelProviderInfo(config);
		const userInput = await buildUserInputMessage(
			prompt,
			config.mode,
			config.cwd,
			userInstructionWatcher,
		);
		const result = await agent.run(userInput);
		persistApiMessages(result.messages);
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
			void updateCliSessionStatus("cancelled", null);
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
		persistCurrentAgentMessages(agent);
		if (config.outputMode === "text") {
			writeln();
		}
		if (!errorAlreadyReported) {
			writeErr(err instanceof Error ? err.message : String(err));
		}
		await updateCliSessionStatus("failed", 1);
		process.exit(1);
	} finally {
		persistCurrentAgentMessages(agent);
		runtime.shutdown("run_complete");
		process.off("SIGINT", handleSigint);
		if (activeRuntimeAbort === abortAll) {
			setActiveRuntimeAbort(undefined);
		}
	}
}

const isDev = process.env.NODE_ENV === "development";

function handleEvent(event: AgentEvent, _config: Config): void {
	if (currentOutputMode === "json") {
		emitJsonLine("stdout", { type: "agent_event", event });
		return;
	}

	switch (event.type) {
		case "iteration_start":
			closeInlineStreamIfNeeded();
			if (isDev) {
				write(`\n${c.yellow}── iteration ${event.iteration} ──${c.reset}\n`);
			}
			break;

		case "iteration_end":
			closeInlineStreamIfNeeded();
			if (!event.hadToolCalls) {
				// write(`\n\n${c.dim}(no tools called, done)${c.reset}\n`)
			}
			break;

		case "content_start":
			switch (event.contentType) {
				case "text":
					if (activeInlineStream !== "text") {
						closeInlineStreamIfNeeded();
						activeInlineStream = "text";
					}
					write(event.text ?? "");
					inlineStreamHasOutput = true;
					break;
				case "reasoning":
					if (activeInlineStream !== "reasoning") {
						closeInlineStreamIfNeeded();
						write(`${c.dim}[thinking] ${c.reset}`);
						activeInlineStream = "reasoning";
						inlineStreamHasOutput = true;
					}
					if (event.redacted && !event.reasoning) {
						write(`${c.dim}[redacted]${c.reset}`);
						inlineStreamHasOutput = true;
						break;
					}
					write(`${c.dim}${event.reasoning ?? ""}${c.reset}`);
					inlineStreamHasOutput = true;
					break;
				case "tool": {
					closeInlineStreamIfNeeded();
					const toolName = event.toolName ?? "unknown_tool";
					const inputStr = formatToolInput(toolName, event.input);
					write(
						`\n${c.dim}[${toolName}]${c.reset} ${c.cyan}${inputStr}${c.reset}`,
					);
					break;
				}
			}
			break;

		case "content_end":
			switch (event.contentType) {
				case "text":
				case "reasoning":
					closeInlineStreamIfNeeded();
					break;
				case "tool":
					closeInlineStreamIfNeeded();
					if (event.error) {
						write(` ${c.red}error: ${event.error}${c.reset}\n`);
					} else {
						const outputStr = formatToolOutput(event.output);
						if (outputStr) {
							write(`  ${c.dim}-> ${outputStr}${c.reset}\n`);
						} else {
							write(` ${c.green}ok${c.reset}\n`);
						}
					}
					break;
			}
			break;

		case "done":
			closeInlineStreamIfNeeded();
			write(
				`\n${c.dim}── finished: ${event.reason} (${event.iterations} iterations) ──${c.reset}\n`,
			);
			activeInlineStream = undefined;
			inlineStreamHasOutput = false;
			break;

		case "error":
			closeInlineStreamIfNeeded();
			writeErr(event.error.message);
			break;
	}
}

function handleTeamEvent(event: TeamEvent): void {
	if (currentOutputMode === "json") {
		emitJsonLine("stdout", { type: "team_event", event });
		return;
	}

	switch (event.type) {
		case "teammate_spawned":
			write(
				`\n${c.dim}[team] teammate spawned:${c.reset} ${c.cyan}${event.agentId}${c.reset}`,
			);
			break;
		case "teammate_shutdown":
			write(
				`\n${c.dim}[team] teammate shutdown:${c.reset} ${c.cyan}${event.agentId}${c.reset}`,
			);
			break;
		case "team_task_updated":
			write(
				`\n${c.dim}[team task]${c.reset} ${c.cyan}${event.task.id}${c.reset} -> ${event.task.status}`,
			);
			break;
		case "team_message":
			write(
				`\n${c.dim}[mailbox]${c.reset} ${event.message.fromAgentId} -> ${event.message.toAgentId}: ${event.message.subject}`,
			);
			break;
		case "team_mission_log":
			write(
				`\n${c.dim}[mission]${c.reset} ${event.entry.agentId}: ${truncate(event.entry.summary, 90)}`,
			);
			break;
		case "task_start":
			void onTeamTaskStart(event.agentId, event.message);
			break;
		case "task_end":
			if (event.error) {
				void onTeamTaskEnd(
					event.agentId,
					"failed",
					`[error] ${event.error.message}`,
				);
			} else if (event.result?.finishReason === "aborted") {
				void onTeamTaskEnd(
					event.agentId,
					"cancelled",
					"[done] aborted",
					event.result.messages,
				);
			} else {
				void onTeamTaskEnd(
					event.agentId,
					"completed",
					`[done] ${event.result?.finishReason ?? "completed"}`,
					event.result?.messages,
				);
			}
			break;
		case "agent_event":
			break;
	}
}

// =============================================================================
// Interactive Mode
// =============================================================================

async function runInteractive(
	config: Config,
	userInstructionWatcher?: UserInstructionConfigWatcher,
	initialMessages?: providers.Message[],
): Promise<void> {
	if (config.outputMode === "json") {
		writeErr("interactive mode is not supported with --output json");
		process.exit(1);
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
	const runtime = new DefaultRuntimeBuilder().build({
		config,
		hooks,
		onTeamEvent: handleTeamEvent,
		createSpawnTool: () => createCliSpawnTool(config, hooks),
		defaultToolExecutors: {
			askQuestion: askQuestionInTerminal,
		},
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
	const { tools } = runtime;

	// Create a single agent for the interactive session to maintain conversation history
	let agent: Agent;
	let turnErrorReported = false;
	const onEvent = (event: AgentEvent) => {
		if (event.type === "error") {
			turnErrorReported = true;
		}
		handleEvent(event, config);
		if ((event.type === "iteration_end" || event.type === "done") && agent) {
			persistCurrentAgentMessages(agent);
		}
	};
	agent = new Agent({
		providerId: config.providerId,
		modelId: config.modelId,
		apiKey: config.apiKey,
		baseUrl: config.baseUrl,
		knownModels: config.knownModels,
		thinking: config.thinking,
		systemPrompt: config.systemPrompt,
		tools,
		maxIterations: config.maxIterations,
		onEvent,
		hooks,
		toolPolicies: config.toolPolicies,
		requestToolApproval,
	});
	hydrateAgentMessages(agent, initialMessages ?? []);

	let isFirstMessage = (initialMessages?.length ?? 0) === 0;
	let isRunning = false;
	let abortRequested = false;
	const abortAll = (reason: string) => {
		if (abortRequested) {
			return false;
		}
		abortRequested = true;
		agent.abort();
		runtime.shutdown(reason);
		return true;
	};
	setActiveRuntimeAbort(abortAll);
	const handleSigint = () => {
		if (isRunning) {
			if (abortAll("sigint")) {
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

	process.on("SIGINT", handleSigint);

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

			let result: AgentResult;
			if (isFirstMessage) {
				printModelProviderInfo(config);
				const userInput = await buildUserInputMessage(
					input,
					config.mode,
					config.cwd,
					userInstructionWatcher,
				);
				result = await agent.run(userInput);
				isFirstMessage = false;
			} else {
				const userInput = await buildUserInputMessage(
					input,
					config.mode,
					config.cwd,
					userInstructionWatcher,
				);
				result = await agent.continue(userInput);
			}
			persistApiMessages(result.messages);

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
					if (result.iterations > 1) {
						parts.push(`${result.iterations} iterations`);
					}
				}
				writeln(`${c.dim}[${parts.join(" | ")}]${c.reset}`);
			}

			writeln();
		} catch (err) {
			persistCurrentAgentMessages(agent);
			writeln();
			if (!turnErrorReported) {
				writeErr(err instanceof Error ? err.message : String(err));
			}
			writeln();
		} finally {
			persistCurrentAgentMessages(agent);
			isRunning = false;
			rl.resume();
			rl.prompt();
		}
	});

	rl.on("close", () => {
		persistCurrentAgentMessages(agent);
		process.off("SIGINT", handleSigint);
		abortAll("interactive_close");
		if (activeRuntimeAbort === abortAll) {
			setActiveRuntimeAbort(undefined);
		}
		writeln();
		process.exit(0);
	});
}

// =============================================================================
// Argument Parsing (minimal, no dependencies)
// =============================================================================

function showHelp(): void {
	writeln(`${c.bold}clite${c.reset} - Lightweight CLI for Cline agentic capabilities

${c.bold}USAGE${c.reset}
  clite [OPTIONS] [PROMPT]
  clite -i                    Interactive mode
  clite list history          List saved history items
  clite list hooks            List hook file locations
  clite list mcp              List configured MCP servers
  clite auth <provider>       Run OAuth login (cline|openai-codex|oca)
  clite hook < payload.json   Handle hook payload from stdin
  clite rpc start             Start RPC server
  clite list <workflows|rules|skills|agents|history|hooks|mcp>
                              List workflow/rule/skill/agent configs, history, or hook file paths
  echo "prompt" | clite       Pipe input

${c.bold}OPTIONS${c.reset}
  -s, --system <prompt>       System prompt for the agent
  -m, --model <id>            Model ID (default: claude-sonnet-4-20250514)
  -p, --provider <id>         Provider ID (default: anthropic)
  -k, --key <api-key>         API key override for this run
  -n, --max-iterations <n>    Max agentic loop iterations (currently ignored; runtime is unbounded)
  -i, --interactive           Interactive mode with multi-turn conversation
  -u, --usage                 Show token usage after response
  -t, --timings               Show timing information
  --thinking                  Enable model thinking/reasoning when supported
  --mode <act|plan>           Agent mode for tool presets (default: act)
  --output <text|json>        Output format (default: text)
  --json                      Shorthand for --output json (NDJSON stream)
  --sandbox                   Run with isolated local state (no writes to ~/.cline)
  --sandbox-dir <path>        Sandbox state directory (default: $CLINE_SANDBOX_DATA_DIR or /tmp/cline-sandbox)
  --no-tools                  Disable default tools (enabled by default)
  --no-spawn                  Disable spawn_agent tool (enabled by default)
  --no-teams                  Disable agent-team tools (enabled by default)
  --auto-approve-tools        Skip approval prompts for tools (default)
  --require-tool-approval     Require approval before each tool call
  --tool-enable <name>        Explicitly enable a tool
  --tool-disable <name>       Explicitly disable a tool
  --tool-autoapprove <name>   Auto-approve a specific tool
  --tool-require-approval <name>
                              Require approval for a specific tool
  --team-name <name>          Team name for runtime state (default: agent-team-\${nanoid(5)})
  --mission-step-interval <n> Mission log update interval in meaningful steps (default: 3)
  --mission-time-interval-ms <ms>
                              Mission log update interval in milliseconds (default: 120000)
  --cwd <path>                Working directory for tools (default: current dir)
  --session <id>              Resume interactive chat from a saved session id
  -h, --help                  Show this help
  -v, --version               Show version

${c.bold}ENVIRONMENT${c.reset}
  ANTHROPIC_API_KEY           API key for Anthropic
  CLINE_API_KEY               API key for CLINE (when using -p cline)
  CLINE_DATA_DIR              Base data directory (sessions/settings/teams/hooks)
  CLINE_SANDBOX               Set to 1 to force sandbox mode
  CLINE_SANDBOX_DATA_DIR      Override sandbox state directory
  CLINE_TEAM_DATA_DIR         Override team persistence directory
  OPENAI_API_KEY              API key for OpenAI (when using -p openai)
  OPENROUTER_API_KEY          API key for Openrouter (when using -p openrouter)
  AI_GATEWAY_API_KEY          API key for Vercel AI Gateway (when using -p vercel-ai-gateway)

${c.bold}EXAMPLES${c.reset}
  clite list history
  clite --session 1700000000000_abcde_cli
  clite list workflows
  clite list rules --json
  clite list skills
  clite list agents
  clite list hooks
  clite list mcp
  clite auth openai-codex
  clite auth oca
  clite rpc start
  clite rpc start --address 127.0.0.1:4317
  clite "What is 2+2?"
  clite "Read package.json and summarize it"
  clite "Search for TODO comments in the codebase"
  clite -s "You are a pirate" "Tell me about the sea"
  clite -i
  clite --tools --teams "Create teammates for planner/coder/reviewer and execute tasks"
  clite --no-tools "Answer from general knowledge only"
  cat file.txt | clite "Summarize this"
`);
}

function showVersion(): void {
	writeln(version);
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
	installStreamErrorGuards();

	const rawArgs = process.argv.slice(2);
	let args = parseArgs(rawArgs);
	const cwd = args.cwd ?? process.cwd();
	const sandboxEnabled =
		args.sandbox || process.env.CLINE_SANDBOX?.trim() === "1";
	const sandboxDataDir = configureSandboxEnvironment({
		enabled: sandboxEnabled,
		cwd,
		explicitDir: args.sandboxDir,
	});
	const providerSettingsManager = new ProviderSettingsManager();
	migrateLegacyProviderSettings({ providerSettingsManager });

	if (rawArgs[0] === "hook") {
		const code = await runHookCommand(writeErr);
		process.exit(code);
	}
	if (rawArgs[0] === "rpc" && rawArgs[1] === "start") {
		const code = await runRpcStartCommand(rawArgs, writeln, writeErr);
		process.exit(code);
	}
	if (rawArgs[0] === "auth") {
		const explicitProviderArg =
			rawArgs[1] && !rawArgs[1].startsWith("-") ? rawArgs[1] : undefined;
		const lastUsedProvider =
			providerSettingsManager.getLastUsedProviderSettings()?.provider;
		const providerId = normalizeAuthProviderId(
			explicitProviderArg || args.provider?.trim() || lastUsedProvider || "",
		);
		if (!providerId) {
			writeErr(`auth requires a provider (example: "clite auth openai-codex")`);
			process.exit(1);
		}
		const code = await runAuthProviderCommand(
			providerSettingsManager,
			providerId,
			{ writeln, writeErr },
		);
		process.exit(code);
	}
	if (rawArgs[0] === "list") {
		if (args.invalidOutputMode) {
			writeErr(
				`invalid output mode "${args.invalidOutputMode}" (expected "text" or "json")`,
			);
			process.exit(1);
		}
		if (args.invalidMode) {
			writeErr(`invalid mode "${args.invalidMode}" (expected "act" or "plan")`);
			process.exit(1);
		}
		currentOutputMode = args.outputMode;
		const listCwd = resolveWorkspaceRoot(cwd);
		const listTarget = rawArgs[1]?.trim().toLowerCase();
		if (listTarget === "history") {
			const limitIndex = rawArgs.indexOf("--limit");
			const limit =
				limitIndex >= 0 && limitIndex + 1 < rawArgs.length
					? Number.parseInt(rawArgs[limitIndex + 1] ?? "200", 10)
					: 200;
			await runHistoryListCommand(Number.isFinite(limit) ? limit : 200);
			process.exit(0);
		}
		const code = await runListCommand({
			rawArgs,
			cwd: listCwd,
			outputMode: args.outputMode,
			io: { writeln, writeErr },
		});
		process.exit(code);
	}
	if (rawArgs[0] === "sessions" && rawArgs[1] === "list") {
		const limitIndex = rawArgs.indexOf("--limit");
		const limit =
			limitIndex >= 0 && limitIndex + 1 < rawArgs.length
				? Number.parseInt(rawArgs[limitIndex + 1] ?? "200", 10)
				: 200;
		process.stdout.write(
			JSON.stringify(
				await listCliSessions(Number.isFinite(limit) ? limit : 200),
			),
		);
		process.exit(0);
	}
	if (rawArgs[0] === "sessions" && rawArgs[1] === "delete") {
		const idIndex = rawArgs.indexOf("--session-id");
		const sessionId =
			idIndex >= 0 && idIndex + 1 < rawArgs.length ? rawArgs[idIndex + 1] : "";
		if (!sessionId) {
			writeErr("sessions delete requires --session-id <id>");
			process.exit(1);
		}
		process.stdout.write(JSON.stringify(await deleteCliSession(sessionId)));
		process.exit(0);
	}
	let initialMessages: providers.Message[] | undefined;
	if (args.sessionId !== undefined) {
		const sessionId = args.sessionId.trim();
		if (!sessionId) {
			writeErr("--session requires <id>");
			process.exit(1);
		}
		initialMessages = await loadSessionMessages(sessionId);
		process.env.CLINE_HOOK_AGENT_RESUME = "1";
		args = {
			...args,
			interactive: true,
			prompt: undefined,
		};
	} else {
		delete process.env.CLINE_HOOK_AGENT_RESUME;
	}

	if (args.invalidOutputMode) {
		writeErr(
			`invalid output mode "${args.invalidOutputMode}" (expected "text" or "json")`,
		);
		process.exit(1);
	}
	if (args.invalidMode) {
		writeErr(`invalid mode "${args.invalidMode}" (expected "act" or "plan")`);
		process.exit(1);
	}
	currentOutputMode = args.outputMode;
	const defaultToolAutoApprove = args.defaultToolAutoApprove;
	const mergedToolPolicies = mergeToolPolicies({}, args.toolPolicies);
	const toolPolicies: Record<string, ToolPolicy> = {
		"*": {
			autoApprove: defaultToolAutoApprove,
		},
	};
	for (const [name, policy] of Object.entries(mergedToolPolicies)) {
		toolPolicies[name] = {
			enabled: policy.enabled,
			autoApprove: policy.autoApprove ?? defaultToolAutoApprove,
		};
	}

	if (args.showHelp) {
		showHelp();
		return;
	}

	if (args.showVersion) {
		showVersion();
		return;
	}

	const userInstructionWatcher = createUserInstructionConfigWatcher({
		skills: { workspacePath: cwd },
		rules: { workspacePath: cwd },
		workflows: { workspacePath: cwd },
	});
	await userInstructionWatcher.start().catch(() => {});
	const stopUserInstructionWatcher = () => {
		userInstructionWatcher.stop();
	};
	process.on("exit", stopUserInstructionWatcher);

	const lastUsedProviderSettings =
		providerSettingsManager.getLastUsedProviderSettings();
	const provider = normalizeProviderId(
		args.provider?.trim() || lastUsedProviderSettings?.provider || "anthropic",
	);
	let selectedProviderSettings =
		providerSettingsManager.getProviderSettings(provider);
	const persistedApiKey = getPersistedProviderApiKey(
		provider,
		selectedProviderSettings,
	);
	let apiKey = args.key?.trim() || persistedApiKey || undefined;

	if (!apiKey && isOAuthProvider(provider)) {
		const oauthResult = await ensureOAuthProviderApiKey({
			providerId: provider,
			currentApiKey: apiKey,
			existingSettings: selectedProviderSettings,
			providerSettingsManager,
			io: { writeln, writeErr },
		});
		selectedProviderSettings = oauthResult.selectedProviderSettings;
		apiKey = oauthResult.apiKey;
	}

	let knownModels: Config["knownModels"];
	try {
		const resolvedProviderConfig = await providers.resolveProviderConfig(
			provider,
			{
				loadLatestOnInit: true,
				loadPrivateOnAuth: true,
				failOnError: false,
			},
		);
		knownModels = resolvedProviderConfig?.knownModels;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		writeln(
			`${c.dim}[model-catalog] latest refresh failed, using bundled defaults (${message})${c.reset}`,
		);
	}
	const knownModelIds = knownModels ? Object.keys(knownModels) : [];

	const config: Config = {
		providerId: provider,
		modelId:
			args.model ??
			selectedProviderSettings?.model ??
			knownModelIds[0] ??
			"claude-sonnet-4-6",
		apiKey: apiKey ?? "",
		knownModels,
		systemPrompt:
			args.systemPrompt ??
			(await buildDefaultSystemPrompt(
				cwd,
				loadRulesForSystemPromptFromWatcher(userInstructionWatcher),
			)),
		maxIterations: undefined,
		sandbox: sandboxEnabled,
		sandboxDataDir,
		showUsage: args.showUsage,
		showTimings: args.showTimings,
		thinking: args.thinking,
		outputMode: args.outputMode,
		mode: args.mode,
		defaultToolAutoApprove,
		toolPolicies,
		enableSpawnAgent: args.enableSpawnAgent,
		enableAgentTeams: args.enableAgentTeams,
		enableTools: args.enableTools,
		cwd,
		teamName: args.enableAgentTeams
			? args.teamName?.trim() || createTeamName()
			: undefined,
		missionLogIntervalSteps:
			typeof args.missionLogIntervalSteps === "number" &&
			Number.isFinite(args.missionLogIntervalSteps)
				? args.missionLogIntervalSteps
				: 3,
		missionLogIntervalMs:
			typeof args.missionLogIntervalMs === "number" &&
			Number.isFinite(args.missionLogIntervalMs)
				? args.missionLogIntervalMs
				: 120000,
	};
	try {
		providerSettingsManager.saveProviderSettings({
			...(selectedProviderSettings ?? {}),
			provider,
			model: config.modelId,
			...(apiKey ? { apiKey } : {}),
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		writeln(
			`${c.dim}[provider-settings] failed to persist selection (${message})${c.reset}`,
		);
	}
	bindCliSessionExitHandlers();

	// Check for piped input
	if (!process.stdin.isTTY && !args.interactive) {
		const chunks: Buffer[] = [];
		for await (const chunk of process.stdin) {
			chunks.push(chunk as Buffer);
		}
		const pipedInput = Buffer.concat(chunks).toString("utf-8").trim();

		if (pipedInput) {
			const prompt = args.prompt
				? `${args.prompt}\n\n${pipedInput}`
				: pipedInput;
			activeCliSession = await createCliSession(config, prompt, false);
			await runAgent(prompt, config, userInstructionWatcher);
			if (activeCliSession?.manifest.status === "running") {
				await updateCliSessionStatus("completed", 0);
			}
			stopUserInstructionWatcher();
			process.off("exit", stopUserInstructionWatcher);
			return;
		}
	}

	if (config.outputMode === "json" && (args.interactive || !args.prompt)) {
		stopUserInstructionWatcher();
		process.off("exit", stopUserInstructionWatcher);
		writeErr(
			"JSON output mode requires a prompt argument or piped stdin (interactive mode is unsupported)",
		);
		process.exit(1);
	}

	// Interactive mode
	if (args.interactive || !args.prompt) {
		activeCliSession = await createCliSession(config, undefined, true);
		await runInteractive(config, userInstructionWatcher, initialMessages);
		if (activeCliSession?.manifest.status === "running") {
			await updateCliSessionStatus("completed", 0);
		}
		stopUserInstructionWatcher();
		process.off("exit", stopUserInstructionWatcher);
		return;
	}

	// Single prompt mode
	activeCliSession = await createCliSession(config, args.prompt, false);
	await runAgent(args.prompt, config, userInstructionWatcher);
	if (activeCliSession?.manifest.status === "running") {
		await updateCliSessionStatus("completed", 0);
	}
	stopUserInstructionWatcher();
	process.off("exit", stopUserInstructionWatcher);
	// Exit once agent is done in non-interactive mode
	return;
}

main().catch(async (err) => {
	writeErr(err instanceof Error ? err.message : String(err));
	await updateCliSessionStatus("failed", 1);
	process.exit(1);
});
