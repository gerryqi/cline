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

import { homedir } from "node:os";
import { createInterface } from "node:readline";
import type { AgentEvent, ToolPolicy } from "@cline/agents";
import {
	ClineAccountService,
	createTeamName,
	createUserInstructionConfigWatcher,
	loadRulesForSystemPromptFromWatcher,
	migrateLegacyProviderSettings,
	ProviderSettingsManager,
	prewarmFileIndex,
	SessionSource,
	type UserInstructionConfigWatcher,
} from "@cline/core/server";
import { providers } from "@cline/llms";
import { setHomeDir } from "@cline/shared/storage";
import { version } from "../package.json";
import { askQuestionInTerminal, requestToolApproval } from "./approval";
import {
	ensureOAuthProviderApiKey,
	getPersistedProviderApiKey,
	isOAuthProvider,
	normalizeAuthProviderId,
	normalizeProviderId,
	runAuthProviderCommand,
} from "./commands/auth";
import { runHookCommand } from "./commands/hook";
import { runHistoryListCommand, runListCommand } from "./commands/list";
import {
	runRpcEnsureCommand,
	runRpcRegisterCommand,
	runRpcStartCommand,
	runRpcStatusCommand,
	runRpcStopCommand,
} from "./commands/rpc";
import { handleEvent, handleTeamEvent } from "./events";
import { createRuntimeHooks } from "./hooks";
import {
	c,
	emitJsonLine,
	formatCreditBalance,
	formatUsd,
	getActiveCliSession,
	installStreamErrorGuards,
	normalizeCreditBalance,
	setActiveCliSession,
	setCurrentOutputMode,
	writeErr,
	writeln,
} from "./output";
import {
	buildDefaultSystemPrompt,
	buildUserInputMessage,
} from "./runtime/prompt";
import {
	configureSandboxEnvironment,
	parseArgs,
	resolveWorkspaceRoot,
} from "./utils/helpers";
import { loadInteractiveResumeMessages } from "./utils/resume";
import {
	createDefaultCliSessionManager,
	deleteSession,
	listSessions,
} from "./utils/session";
import type { Config } from "./utils/types";

let activeRuntimeAbort: (() => void) | undefined;

function setActiveRuntimeAbort(abortFn: (() => void) | undefined): void {
	activeRuntimeAbort = abortFn;
}

function abortActiveRuntime(): void {
	try {
		activeRuntimeAbort?.();
	} catch {
		// Best-effort abort path.
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

async function resolveInteractiveClineWelcomeLine(input: {
	config: Config;
	clineApiBaseUrl?: string;
	clineProviderSettings?: providers.ProviderSettings;
}): Promise<string | undefined> {
	if (input.config.providerId !== "cline") {
		return undefined;
	}
	const persistedAccessToken =
		input.clineProviderSettings?.auth?.accessToken?.trim() || "";
	const configApiKey = input.config.apiKey.trim();
	let authToken = persistedAccessToken || configApiKey;
	if (authToken.startsWith("workos:workos:")) {
		authToken = authToken.slice("workos:".length);
	}
	if (!authToken) {
		return undefined;
	}

	const service = new ClineAccountService({
		apiBaseUrl: input.clineApiBaseUrl?.trim() || "https://api.cline.bot",
		getAuthToken: async () => authToken,
	});
	try {
		const me = await service.fetchMe();
		const activeOrgName = me.organizations
			.find((org) => org.active)
			?.name?.trim();
		const activeOrganizationId = me.organizations.find(
			(org) => org.active,
		)?.organizationId;
		let rawBalance: number;
		if (activeOrganizationId?.trim()) {
			const orgBalance =
				await service.fetchOrganizationBalance(activeOrganizationId);
			rawBalance = orgBalance.balance;
		} else {
			const userBalance = await service.fetchBalance(me.id);
			rawBalance = userBalance.balance;
		}
		const normalizedBalance = normalizeCreditBalance(rawBalance);
		const parts = [
			me.email,
			`Credits: ${formatCreditBalance(normalizedBalance)}`,
		];
		if (activeOrgName) {
			parts.push(activeOrgName);
		}
		return parts.join(" | ");
	} catch {
		return undefined;
	}
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
	let hasSeenStructuredAgentEvent = false;
	const unsubscribe = sessionManager.subscribe((event: unknown) => {
		const typedEvent = event as
			| { type: "agent_event"; payload: { event: AgentEvent } }
			| { type: "chunk"; payload: { stream: string; chunk: string } }
			| { type: string; payload?: unknown };
		if (typedEvent.type === "agent_event") {
			hasSeenStructuredAgentEvent = true;
			const payload = typedEvent.payload as { event?: AgentEvent } | undefined;
			if (payload?.event) {
				onAgentEvent(payload.event);
			}
			return;
		}
		const chunkEvent = event as
			| { type: "chunk"; payload: { stream: string; chunk: string } }
			| { type: string; payload?: unknown };
		if (
			chunkEvent.type !== "chunk" ||
			!chunkEvent.payload ||
			typeof chunkEvent.payload !== "object"
		) {
			return;
		}
		if (hasSeenStructuredAgentEvent) {
			return;
		}
		const payload = chunkEvent.payload as { stream?: string; chunk?: string };
		if (payload.stream !== "agent" || typeof payload.chunk !== "string") {
			return;
		}
		try {
			onAgentEvent(JSON.parse(payload.chunk) as AgentEvent);
		} catch {
			// Best-effort event parsing path.
		}
	});
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
			config.mode,
			config.cwd,
			userInstructionWatcher,
		);
		const started = await sessionManager.start({
			source: SessionSource.CLI,
			config: {
				...config,
				hooks,
				onTeamEvent: handleTeamEvent,
			},
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
		if (activeRuntimeAbort === abortAll) {
			setActiveRuntimeAbort(undefined);
		}
	}
	if (runFailed) {
		return;
	}
}

// =============================================================================
// Interactive Mode
// =============================================================================

async function runInteractive(
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

	const clineWelcomeLine = await resolveInteractiveClineWelcomeLine({
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
	let hasSeenStructuredAgentEvent = false;
	const unsubscribe = sessionManager.subscribe((event: unknown) => {
		const typedEvent = event as
			| { type: "agent_event"; payload: { event: AgentEvent } }
			| { type: "chunk"; payload: { stream: string; chunk: string } }
			| { type: string; payload?: unknown };
		if (typedEvent.type === "agent_event") {
			hasSeenStructuredAgentEvent = true;
			const payload = typedEvent.payload as { event?: AgentEvent } | undefined;
			if (payload?.event) {
				onAgentEvent(payload.event);
			}
			return;
		}
		const chunkEvent = event as
			| { type: "chunk"; payload: { stream: string; chunk: string } }
			| { type: string; payload?: unknown };
		if (
			chunkEvent.type !== "chunk" ||
			!chunkEvent.payload ||
			typeof chunkEvent.payload !== "object"
		) {
			return;
		}
		if (hasSeenStructuredAgentEvent) {
			return;
		}
		const payload = chunkEvent.payload as { stream?: string; chunk?: string };
		if (payload.stream !== "agent" || typeof payload.chunk !== "string") {
			return;
		}
		try {
			onAgentEvent(JSON.parse(payload.chunk) as AgentEvent);
		} catch {
			// Best-effort event parsing path.
		}
	});

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
				config.mode,
				config.cwd,
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
			if (activeRuntimeAbort === abortAll) {
				setActiveRuntimeAbort(undefined);
			}
			writeln();
			process.exit(0);
		})();
	});
}

// =============================================================================
// Help & Version
// =============================================================================

function showHelp(): void {
	writeln(`${c.bold}clite${c.reset} - Lightweight CLI for Cline agentic capabilities

${c.bold}USAGE${c.reset}
  clite [OPTIONS] [PROMPT]
  clite -i                    Interactive mode
  clite auth <provider>       Run OAuth login (cline|openai-codex|oca)
  clite hook < payload.json   Handle hook payload from stdin
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
  -u, --usage                 Show token usage and estimated cost after response
  -t, --timings               Show timing information
  --thinking                  Enable model thinking/reasoning when supported
  --refresh-models        	  Refresh provider model catalog from live endpoints for this run
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
  clite "What is 2+2?"
  clite "Read package.json and summarize it"
  clite "Search for TODO comments in the codebase"
  clite -s "You are a pirate" "Tell me about the sea"
  clite -i
  clite --tools --teams "Create teammates for planner/coder/reviewer and execute tasks"
  clite --no-tools "Answer from general knowledge only"
  cat file.txt | clite "Summarize this"

${c.bold}INTERNAL${c.reset}
  clite rpc <start|status|stop|ensure> --address <host:port>
						  RPC server commands with custom address
  clite rpc register --client-type <type> --client-id <id>
						  Register a client with RPC server (e.g. --client-type desktop --client-id example)
  clite rpc ensure --json
						  Ensure compatible runtime server, auto-selecting a new port when needed
`);
}

function showVersion(): void {
	writeln(version);
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
	setHomeDir(homedir());
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
	if (rawArgs[0] === "rpc") {
		const rpcSubcommand = rawArgs[1]?.trim().toLowerCase();
		if (rpcSubcommand === "start") {
			const code = await runRpcStartCommand(rawArgs, writeln, writeErr);
			process.exit(code);
		}
		if (rpcSubcommand === "status") {
			const code = await runRpcStatusCommand(rawArgs, writeln, writeErr);
			process.exit(code);
		}
		if (rpcSubcommand === "stop") {
			const code = await runRpcStopCommand(rawArgs, writeln, writeErr);
			process.exit(code);
		}
		if (rpcSubcommand === "ensure") {
			const code = await runRpcEnsureCommand(rawArgs, writeln, writeErr);
			process.exit(code);
		}
		if (rpcSubcommand === "register") {
			const code = await runRpcRegisterCommand(rawArgs, writeln, writeErr);
			process.exit(code);
		}
		writeErr(`unknown rpc subcommand "${rawArgs[1] ?? ""}"`);
		process.exit(1);
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
		setCurrentOutputMode(args.outputMode);
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
		let limit: number;
		if (limitIndex >= 0 && limitIndex + 1 < rawArgs.length) {
			limit = Number.parseInt(rawArgs[limitIndex + 1] ?? "200", 10);
		} else {
			// Support positional numeric argument: `sessions list <n>`
			const positional = rawArgs[2];
			const positionalNum =
				positional !== undefined ? Number.parseInt(positional, 10) : Number.NaN;
			limit = Number.isFinite(positionalNum) ? positionalNum : 200;
		}
		process.stdout.write(
			JSON.stringify(await listSessions(Number.isFinite(limit) ? limit : 200)),
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
		process.stdout.write(JSON.stringify(await deleteSession(sessionId)));
		process.exit(0);
	}
	let resumeSessionId: string | undefined;
	if (args.sessionId !== undefined) {
		const sessionId = args.sessionId.trim();
		if (!sessionId) {
			writeErr("--session requires <id>");
			process.exit(1);
		}
		resumeSessionId = sessionId;
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
	setCurrentOutputMode(args.outputMode);
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
		process.exit(0);
	}

	if (args.showVersion) {
		showVersion();
		process.exit(0);
	}

	const userInstructionWatcher = createUserInstructionConfigWatcher({
		skills: { workspacePath: cwd },
		rules: { workspacePath: cwd },
		workflows: { workspacePath: cwd },
	});
	await userInstructionWatcher.start().catch(() => {});
	let watcherDisposed = false;
	const stopUserInstructionWatcher = () => {
		if (watcherDisposed) {
			return;
		}
		watcherDisposed = true;
		userInstructionWatcher.stop();
	};
	process.on("exit", stopUserInstructionWatcher);
	try {
		const lastUsedProviderSettings =
			providerSettingsManager.getLastUsedProviderSettings();
		const provider = normalizeProviderId(
			args.provider?.trim() ||
				lastUsedProviderSettings?.provider ||
				"anthropic",
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
		if (args.liveModelCatalog) {
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
			// For OAuth providers, don't write the resolved key into apiKey —
			// the token lives in auth.accessToken and apiKey is reserved for
			// migrated/manual keys.
			const persistApiKey =
				apiKey && !isOAuthProvider(provider) ? { apiKey } : {};
			providerSettingsManager.saveProviderSettings({
				...(selectedProviderSettings ?? {}),
				provider,
				model: config.modelId,
				...persistApiKey,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			writeln(
				`${c.dim}[provider-settings] failed to persist selection (${message})${c.reset}`,
			);
		}
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
				await runAgent(prompt, config, userInstructionWatcher);
				return;
			}
		}

		if (config.outputMode === "json" && (args.interactive || !args.prompt)) {
			writeErr(
				"JSON output mode requires a prompt argument or piped stdin (interactive mode is unsupported)",
			);
			process.exit(1);
		}

		// Interactive mode
		if (args.interactive || !args.prompt) {
			await runInteractive(config, userInstructionWatcher, resumeSessionId, {
				clineApiBaseUrl: selectedProviderSettings?.baseUrl,
				clineProviderSettings: selectedProviderSettings,
			});
			return;
		}

		// Single prompt mode
		await runAgent(args.prompt, config, userInstructionWatcher);
		// Exit once agent is done in non-interactive mode
		return;
	} finally {
		stopUserInstructionWatcher();
		process.off("exit", stopUserInstructionWatcher);
	}
}

main().catch((err) => {
	writeErr(err instanceof Error ? err.message : String(err));
	abortActiveRuntime();
	process.exit(1);
});
