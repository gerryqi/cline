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
	mkdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import {
	Agent,
	type AgentEvent,
	type AgentHooks,
	type AgentResult,
	createBuiltinTools,
	createSpawnAgentTool as createSdkSpawnAgentTool,
	createSubprocessHooks,
	getClineDefaultSystemPrompt,
	type TeamEvent,
	type Tool,
	type ToolApprovalRequest,
	type ToolApprovalResult,
	type ToolPolicy,
} from "@cline/agents";
import {
	createTeamName,
	createUserInstructionConfigWatcher,
	DefaultRuntimeBuilder,
	enrichPromptWithMentions,
	generateWorkspaceInfo,
	loadRulesForSystemPromptFromWatcher,
	ProviderSettingsManager,
	prewarmFastFileList,
	type RuleConfig,
	resolveRulesConfigSearchPaths,
	resolveSkillsConfigSearchPaths,
	resolveWorkflowSlashCommandFromWatcher,
	resolveWorkflowsConfigSearchPaths,
	type SessionManifest,
	SessionSource,
	type SkillConfig,
	type UserInstructionConfigWatcher,
	type WorkflowConfig,
} from "@cline/core/server";
import { providers } from "@cline/llms";
import { version } from "../package.json";
import {
	appendHookAudit,
	configureSandboxEnvironment,
	formatToolInput,
	formatToolOutput,
	isCliHookPayload,
	nowIso,
	parseArgs,
	randomSessionId,
	readStdinUtf8,
	resolveWorkspaceRoot,
	truncate,
	writeHookJson,
} from "./utils/helpers";
import {
	appendSubagentHookAudit,
	appendSubagentTranscriptLine,
	applySubagentStatus,
	createRootCliSessionWithArtifacts,
	deleteCliSession,
	handleSubAgentEnd,
	handleSubAgentStart,
	listCliSessions,
	onTeamTaskEnd,
	onTeamTaskStart,
	queueSpawnRequest,
	updateCliSessionStatusInStore,
	upsertSubagentSessionFromHook,
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

function createCliSession(
	config: Config,
	prompt: string | undefined,
	interactive: boolean,
): ActiveCliSession {
	const sessionId = process.env.CLINE_SESSION_ID?.trim() || randomSessionId();
	const created = createRootCliSessionWithArtifacts({
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

function updateCliSessionStatus(
	status: SessionManifest["status"],
	exitCode?: number | null,
): void {
	if (!activeCliSession) {
		return;
	}
	const result = updateCliSessionStatusInStore(
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
	writeCliSessionManifest(
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
			updateCliSessionStatus(code === 0 ? "completed" : "failed", code);
		}
	});
	process.on("SIGTERM", () => {
		abortActiveRuntime("sigterm");
		if (activeCliSession?.manifest.status === "running") {
			updateCliSessionStatus("cancelled", null);
		}
		process.exit(143);
	});
	process.on("SIGINT", () => {
		abortActiveRuntime("sigint");
		if (activeCliSession?.manifest.status === "running") {
			updateCliSessionStatus("cancelled", null);
		}
	});
}

async function buildWorkspaceInfo(cwd: string): Promise<string> {
	const workspaceInfo = await generateWorkspaceInfo(cwd);
	const workspaceConfig = {
		workspaces: {
			[workspaceInfo.rootPath]: {
				hint: workspaceInfo.hint,
				associatedRemoteUrls: workspaceInfo.associatedRemoteUrls,
				latestGitCommitHash: workspaceInfo.latestGitCommitHash,
				latestGitBranchName: workspaceInfo.latestGitBranchName,
			},
		},
	};
	return `# Workspace Configuration\n${JSON.stringify(workspaceConfig, null, 2)}`;
}

async function buildDefaultSystemPrompt(
	cwd: string,
	rules = "",
): Promise<string> {
	const WORKSPACE_INFO = await buildWorkspaceInfo(cwd);
	return getClineDefaultSystemPrompt("Terminal Shell", WORKSPACE_INFO, rules);
}

function normalizeProviderId(providerId: string): string {
	const normalized = providerId.trim();
	return normalized === "openai" ? "openai-native" : normalized;
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

function sanitizeApprovalToken(value: string): string {
	return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestDesktopToolApproval(
	request: ToolApprovalRequest,
): Promise<ToolApprovalResult> {
	const approvalDir = process.env.CLINE_TOOL_APPROVAL_DIR?.trim();
	const sessionId =
		process.env.CLINE_TOOL_APPROVAL_SESSION_ID?.trim() ||
		process.env.CLINE_SESSION_ID?.trim();
	if (!approvalDir || !sessionId) {
		return {
			approved: false,
			reason: "Desktop tool approval IPC is not configured",
		};
	}

	mkdirSync(approvalDir, { recursive: true });
	const requestId = sanitizeApprovalToken(`${request.toolCallId}`);
	const requestPath = join(
		approvalDir,
		`${sessionId}.request.${requestId}.json`,
	);
	const decisionPath = join(
		approvalDir,
		`${sessionId}.decision.${requestId}.json`,
	);

	writeFileSync(
		requestPath,
		JSON.stringify(
			{
				requestId,
				sessionId,
				createdAt: nowIso(),
				toolCallId: request.toolCallId,
				toolName: request.toolName,
				input: request.input,
				iteration: request.iteration,
				agentId: request.agentId,
				conversationId: request.conversationId,
			},
			null,
			2,
		),
		"utf8",
	);

	const timeoutMs = 5 * 60_000;
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		if (existsSync(decisionPath)) {
			try {
				const raw = readFileSync(decisionPath, "utf8");
				const parsed = JSON.parse(raw) as {
					approved?: boolean;
					reason?: string;
				};
				return {
					approved: parsed.approved === true,
					reason: typeof parsed.reason === "string" ? parsed.reason : undefined,
				};
			} catch {
				return { approved: false, reason: "Invalid desktop approval response" };
			} finally {
				try {
					unlinkSync(decisionPath);
				} catch {
					// Best-effort cleanup.
				}
				try {
					unlinkSync(requestPath);
				} catch {
					// Best-effort cleanup.
				}
			}
		}
		await delay(200);
	}

	try {
		unlinkSync(requestPath);
	} catch {
		// Best-effort cleanup.
	}
	return { approved: false, reason: "Tool approval request timed out" };
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
			`\nApprove tool "${request.toolName}" with input ${preview}? [y/N] `,
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
		return requestDesktopToolApproval(request);
	}
	return requestTerminalToolApproval(request);
}

function getHookCommand(): string[] | undefined {
	if (process.env.CLINE_ENABLE_SUBPROCESS_HOOKS !== "1" || !process.argv[1]) {
		return undefined;
	}
	return [process.execPath, process.argv[1], "hook"];
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
	}).hooks;
}

function createBuiltinToolsList(cwd: string): Tool[] {
	return createBuiltinTools({
		cwd,
		enableReadFiles: true,
		enableSearch: true,
		enableBash: true,
		enableWebFetch: true,
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
		createSubAgentTools: () => createBuiltinToolsList(config.cwd),
		hooks,
		toolPolicies: config.toolPolicies,
		requestToolApproval,
		onSubAgentStart: ({ subAgentId, conversationId, parentAgentId, input }) => {
			handleSubAgentStart({
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
			handleSubAgentEnd({
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
	if (config.outputMode === "json") {
		emitJsonLine("stdout", {
			type: "run_start",
			providerId: config.providerId,
			modelId: config.modelId,
			catalog: modelSource,
			thinking: thinkingStatus,
			sessionId: activeCliSession?.manifest.session_id,
		});
		return;
	}
	writeln(
		`${c.dim}[model] provider=${config.providerId} model=${config.modelId} catalog=${modelSource} thinking=${thinkingStatus}${c.reset}`,
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

async function buildUserInputMessage(
	rawPrompt: string,
	cwd: string,
	userInstructionWatcher?: UserInstructionConfigWatcher,
): Promise<string> {
	const resolvedPrompt = userInstructionWatcher
		? resolveWorkflowSlashCommandFromWatcher(rawPrompt, userInstructionWatcher)
		: rawPrompt;
	const enriched = await enrichPromptWithMentions(resolvedPrompt, cwd);
	return `<user_input>${enriched.prompt}</user_input>`;
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
	void prewarmFastFileList(config.cwd);
	const hooks = createRuntimeHooks();
	const runtime = new DefaultRuntimeBuilder().build({
		config,
		hooks,
		onTeamEvent: handleTeamEvent,
		createSpawnTool: () => createCliSpawnTool(config, hooks),
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
			updateCliSessionStatus("cancelled", null);
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
		updateCliSessionStatus("failed", 1);
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
							write(`\n  ${c.dim}-> ${outputStr}${c.reset}\n`);
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
				`\n${c.dim}[team] teammate spawned:${c.reset} ${c.cyan}${event.agentId}${c.reset}\n`,
			);
			break;
		case "teammate_shutdown":
			write(
				`\n${c.dim}[team] teammate shutdown:${c.reset} ${c.cyan}${event.agentId}${c.reset}\n`,
			);
			break;
		case "team_task_updated":
			write(
				`\n${c.dim}[team task]${c.reset} ${c.cyan}${event.task.id}${c.reset} -> ${event.task.status}\n`,
			);
			break;
		case "team_message":
			write(
				`\n${c.dim}[mailbox]${c.reset} ${event.message.fromAgentId} -> ${event.message.toAgentId}: ${event.message.subject}\n`,
			);
			break;
		case "team_mission_log":
			write(
				`\n${c.dim}[mission]${c.reset} ${event.entry.agentId}: ${truncate(event.entry.summary, 90)}\n`,
			);
			break;
		case "task_start":
			onTeamTaskStart(event.agentId, event.message);
			break;
		case "task_end":
			if (event.error) {
				onTeamTaskEnd(
					event.agentId,
					"failed",
					`[error] ${event.error.message}`,
				);
			} else if (event.result?.finishReason === "aborted") {
				onTeamTaskEnd(
					event.agentId,
					"cancelled",
					"[done] aborted",
					event.result.messages,
				);
			} else {
				onTeamTaskEnd(
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
	void prewarmFastFileList(config.cwd);

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

	let isFirstMessage = true;
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
					config.cwd,
					userInstructionWatcher,
				);
				result = await agent.run(userInput);
				isFirstMessage = false;
			} else {
				const userInput = await buildUserInputMessage(
					input,
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

async function runHookCommand(): Promise<number> {
	try {
		const raw = (await readStdinUtf8()).trim();
		if (!raw) {
			writeErr("hook command expects JSON payload on stdin");
			return 1;
		}

		const parsed = JSON.parse(raw) as unknown;
		if (!isCliHookPayload(parsed)) {
			writeErr("invalid hook payload");
			return 1;
		}

		appendHookAudit(parsed);
		queueSpawnRequest(parsed);
		const subSessionId = upsertSubagentSessionFromHook(parsed);
		if (subSessionId) {
			appendSubagentHookAudit(subSessionId, parsed);
			if (parsed.hook_event_name === "tool_call") {
				appendSubagentTranscriptLine(
					subSessionId,
					`[tool] ${parsed.tool_call?.name ?? "unknown"}`,
				);
			}
			if (parsed.hook_event_name === "agent_end") {
				appendSubagentTranscriptLine(subSessionId, "[done] completed");
			}
			if (parsed.hook_event_name === "session_shutdown") {
				appendSubagentTranscriptLine(
					subSessionId,
					`[shutdown] ${parsed.reason ?? "session shutdown"}`,
				);
			}
			applySubagentStatus(subSessionId, parsed);
		}

		switch (parsed.hook_event_name) {
			case "tool_call":
				// Return control surface JSON for pre-execution tool interception.
				writeHookJson({});
				return 0;
			case "tool_result":
			case "agent_end":
			case "session_shutdown":
				// Fire-and-forget events; no control response needed.
				writeHookJson({});
				return 0;
			default:
				writeErr(
					`unsupported hook_event_name: ${(parsed as { hook_event_name: string }).hook_event_name}`,
				);
				return 1;
		}
	} catch (error) {
		writeErr(error instanceof Error ? error.message : String(error));
		return 1;
	}
}

function showHelp(): void {
	writeln(`${c.bold}clite${c.reset} - Lightweight CLI for Cline agentic capabilities

${c.bold}USAGE${c.reset}
  clite [OPTIONS] [PROMPT]
  clite -i                    Interactive mode
  clite hook < payload.json   Handle hook payload from stdin
  clite list <workflows|rules|skills>
                              List enabled workflow/rule/skill configs
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
  clite list workflows
  clite list rules --json
  clite list skills
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

async function runWorkflowsListCommand(
	cwd: string,
	outputMode: CliOutputMode,
): Promise<number> {
	const workflowsById = new Map<
		string,
		{ id: string; name: string; instructions: string; path: string }
	>();
	const directories = resolveWorkflowsConfigSearchPaths(cwd).filter(
		(directory) => existsSync(directory),
	);
	for (const directory of directories) {
		const watcher = createUserInstructionConfigWatcher({
			skills: { directories: [] },
			rules: { directories: [] },
			workflows: { directories: [directory] },
		});
		try {
			await watcher.start();
			const snapshot = watcher.getSnapshot("workflow");
			for (const [id, record] of snapshot.entries()) {
				const workflow = record.item as WorkflowConfig;
				if (workflow.disabled === true || workflowsById.has(id)) {
					continue;
				}
				workflowsById.set(id, {
					id,
					name: workflow.name,
					instructions: workflow.instructions,
					path: record.filePath,
				});
			}
		} catch {
			// Best-effort listing across config roots.
		} finally {
			watcher.stop();
		}
	}
	const workflows = [...workflowsById.values()].sort((a, b) =>
		a.name.localeCompare(b.name),
	);
	if (outputMode === "json") {
		process.stdout.write(JSON.stringify(workflows));
		return 0;
	}
	if (workflows.length === 0) {
		writeln("No enabled workflows found.");
		return 0;
	}
	writeln("Available workflows:");
	for (const workflow of workflows) {
		writeln(`  /${workflow.name} (${workflow.path})`);
	}
	return 0;
}

async function runRulesListCommand(
	cwd: string,
	outputMode: CliOutputMode,
): Promise<number> {
	const rulesByName = new Map<
		string,
		{ name: string; instructions: string; path: string }
	>();
	const directories = resolveRulesConfigSearchPaths(cwd).filter((directory) =>
		existsSync(directory),
	);
	for (const directory of directories) {
		const watcher = createUserInstructionConfigWatcher({
			skills: { directories: [] },
			rules: { directories: [directory] },
			workflows: { directories: [] },
		});
		try {
			await watcher.start();
			const snapshot = watcher.getSnapshot("rule");
			for (const record of snapshot.values()) {
				const rule = record.item as RuleConfig;
				if (rule.disabled === true || rulesByName.has(rule.name)) {
					continue;
				}
				rulesByName.set(rule.name, {
					name: rule.name,
					instructions: rule.instructions,
					path: record.filePath,
				});
			}
		} catch {
			// Best-effort listing across config roots.
		} finally {
			watcher.stop();
		}
	}
	const rules = [...rulesByName.values()].sort((a, b) =>
		a.name.localeCompare(b.name),
	);
	if (outputMode === "json") {
		process.stdout.write(JSON.stringify(rules));
		return 0;
	}
	if (rules.length === 0) {
		writeln("No enabled rules found.");
		return 0;
	}
	writeln("Enabled rules:");
	for (const rule of rules) {
		writeln(`  ${rule.name} (${rule.path})`);
	}
	return 0;
}

async function runSkillsListCommand(
	cwd: string,
	outputMode: CliOutputMode,
): Promise<number> {
	const skillDirectories = [
		...resolveSkillsConfigSearchPaths(cwd),
		join(homedir(), "Documents", "Cline", "Skills"),
	];
	const skillsByName = new Map<
		string,
		SkillConfig & {
			path: string;
		}
	>();
	const directories = [...new Set(skillDirectories)].filter((directory) =>
		existsSync(directory),
	);
	for (const directory of directories) {
		const watcher = createUserInstructionConfigWatcher({
			skills: { directories: [directory] },
			rules: { directories: [] },
			workflows: { directories: [] },
		});
		try {
			await watcher.start();
			const snapshot = watcher.getSnapshot("skill");
			for (const record of snapshot.values()) {
				const skill = record.item as SkillConfig;
				if (skill.disabled === true || skillsByName.has(skill.name)) {
					continue;
				}
				skillsByName.set(skill.name, {
					...skill,
					path: record.filePath,
				});
			}
		} catch {
			// Best-effort listing across config roots.
		} finally {
			watcher.stop();
		}
	}
	const skills = [...skillsByName.values()].sort((a, b) =>
		a.name.localeCompare(b.name),
	);
	if (outputMode === "json") {
		process.stdout.write(JSON.stringify(skills));
		return 0;
	}
	if (skills.length === 0) {
		writeln("No enabled skills found.");
		return 0;
	}
	writeln("Enabled skills:");
	for (const skill of skills) {
		writeln(`  ${skill.name} (${skill.path})`);
	}
	return 0;
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
	installStreamErrorGuards();

	const rawArgs = process.argv.slice(2);
	const args = parseArgs(rawArgs);
	const cwd = args.cwd ?? process.cwd();
	const sandboxEnabled =
		args.sandbox || process.env.CLINE_SANDBOX?.trim() === "1";
	const sandboxDataDir = configureSandboxEnvironment({
		enabled: sandboxEnabled,
		cwd,
		explicitDir: args.sandboxDir,
	});

	if (rawArgs[0] === "hook") {
		const code = await runHookCommand();
		process.exit(code);
	}
	if (rawArgs[0] === "list") {
		if (args.invalidOutputMode) {
			writeErr(
				`invalid output mode "${args.invalidOutputMode}" (expected "text" or "json")`,
			);
			process.exit(1);
		}
		currentOutputMode = args.outputMode;
		const listCwd = resolveWorkspaceRoot(cwd);
		const listTarget = rawArgs[1]?.trim().toLowerCase();
		let code = 1;
		if (listTarget === "workflows") {
			code = await runWorkflowsListCommand(listCwd, args.outputMode);
		} else if (listTarget === "rules") {
			code = await runRulesListCommand(listCwd, args.outputMode);
		} else if (listTarget === "skills") {
			code = await runSkillsListCommand(listCwd, args.outputMode);
		} else {
			writeErr(
				`list requires one of: workflows, rules, skills (got "${rawArgs[1] ?? ""}")`,
			);
			process.exit(1);
		}
		process.exit(code);
	}
	if (rawArgs[0] === "sessions" && rawArgs[1] === "list") {
		const limitIndex = rawArgs.indexOf("--limit");
		const limit =
			limitIndex >= 0 && limitIndex + 1 < rawArgs.length
				? Number.parseInt(rawArgs[limitIndex + 1] ?? "200", 10)
				: 200;
		process.stdout.write(
			JSON.stringify(listCliSessions(Number.isFinite(limit) ? limit : 200)),
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
		process.stdout.write(JSON.stringify(deleteCliSession(sessionId)));
		process.exit(0);
	}

	if (args.invalidOutputMode) {
		writeErr(
			`invalid output mode "${args.invalidOutputMode}" (expected "text" or "json")`,
		);
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

	const providerSettingsManager = new ProviderSettingsManager();
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
	const selectedProviderSettings =
		providerSettingsManager.getProviderSettings(provider);
	const persistedApiKey =
		selectedProviderSettings?.apiKey?.trim() ||
		selectedProviderSettings?.auth?.apiKey?.trim() ||
		undefined;
	const apiKey = args.key?.trim() || persistedApiKey || undefined;

	let knownModels: Config["knownModels"];
	try {
		const liveCatalog = await providers.getLiveModelsCatalog();
		knownModels = liveCatalog[provider];
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		writeln(
			`${c.dim}[model-catalog] latest refresh failed, using bundled defaults (${message})${c.reset}`,
		);
	}

	const config: Config = {
		providerId: provider,
		modelId:
			args.model ??
			selectedProviderSettings?.model ??
			knownModels?.[0]?.id ??
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
			activeCliSession = createCliSession(config, prompt, false);
			await runAgent(prompt, config, userInstructionWatcher);
			if (activeCliSession?.manifest.status === "running") {
				updateCliSessionStatus("completed", 0);
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
		activeCliSession = createCliSession(config, undefined, true);
		await runInteractive(config, userInstructionWatcher);
		if (activeCliSession?.manifest.status === "running") {
			updateCliSessionStatus("completed", 0);
		}
		stopUserInstructionWatcher();
		process.off("exit", stopUserInstructionWatcher);
		return;
	}

	// Single prompt mode
	activeCliSession = createCliSession(config, args.prompt, false);
	await runAgent(args.prompt, config, userInstructionWatcher);
	if (activeCliSession?.manifest.status === "running") {
		updateCliSessionStatus("completed", 0);
	}
	stopUserInstructionWatcher();
	process.off("exit", stopUserInstructionWatcher);
	// Exit once agent is done in non-interactive mode
	return;
}

main().catch((err) => {
	writeErr(err instanceof Error ? err.message : String(err));
	updateCliSessionStatus("failed", 1);
	process.exit(1);
});
