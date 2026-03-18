import { homedir } from "node:os";
import type { ToolPolicy } from "@clinebot/core";
import { setHomeDir } from "@clinebot/core";
import {
	ensureOAuthProviderApiKey,
	getPersistedProviderApiKey,
	isOAuthProvider,
	normalizeProviderId,
	parseAuthCommandArgs,
	runAuthCommand,
} from "./commands/auth";
import { runConnectCommand } from "./commands/connect";
import { runDevCommand } from "./commands/dev";
import { showHelp, showVersion } from "./commands/help";
import { runHookCommand } from "./commands/hook";
import { runScheduleCommand } from "./commands/schedule";
import { createCliLoggerAdapter } from "./logging/adapter";
import {
	configureSandboxEnvironment,
	parseArgs,
	resolveWorkspaceRoot,
} from "./utils/helpers";
import {
	c,
	installStreamErrorGuards,
	setCurrentOutputMode,
	writeErr,
	writeln,
} from "./utils/output";
import type { Config } from "./utils/types";

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

async function createProviderSettingsManager() {
	const { ProviderSettingsManager } = await import("@clinebot/core/server");
	return new ProviderSettingsManager();
}

async function loadCliRuntimeModules() {
	const [coreServer, llms, prompt, runAgentModule] = await Promise.all([
		import("@clinebot/core/server"),
		import("@clinebot/llms"),
		import("./runtime/prompt"),
		import("./runtime/run-agent"),
	]);
	return {
		coreServer,
		llms,
		resolveSystemPrompt: prompt.resolveSystemPrompt,
		runAgent: runAgentModule.runAgent,
	};
}

async function loadInteractiveRuntimeModule() {
	const { runInteractive } = await import("./runtime/run-interactive");
	return runInteractive;
}

function resolveConfigDirArg(rawArgs: string[]): string | undefined {
	const index = rawArgs.indexOf("--config");
	if (index < 0 || index + 1 >= rawArgs.length) {
		return undefined;
	}
	const value = rawArgs[index + 1]?.trim();
	return value ? value : undefined;
}

function normalizeTopLevelArgs(rawArgs: string[]): string[] {
	const command = rawArgs[0]?.trim().toLowerCase();
	if (command === "task" || command === "t") {
		return rawArgs.slice(1);
	}
	if (command === "h") {
		return ["history", ...rawArgs.slice(1)];
	}
	return rawArgs;
}

export async function runCli(): Promise<void> {
	installStreamErrorGuards();

	const rawArgsInput = process.argv.slice(2);
	const rawArgs = normalizeTopLevelArgs(rawArgsInput);
	setHomeDir(resolveConfigDirArg(rawArgsInput) ?? homedir());
	if (rawArgs[0] === "connect") {
		const code = await runConnectCommand(rawArgs, {
			writeln,
			writeErr,
		});
		process.exit(code);
	}
	const launchConfigView = rawArgs[0]?.trim().toLowerCase() === "config";
	const parsedArgsInput = launchConfigView ? rawArgs.slice(1) : rawArgs;
	let args = parseArgs(parsedArgsInput);
	const cwd = args.cwd ?? process.cwd();
	const sandboxEnabled =
		args.sandbox || process.env.CLINE_SANDBOX?.trim() === "1";
	const sandboxDataDir = configureSandboxEnvironment({
		enabled: sandboxEnabled,
		cwd,
		explicitDir: args.sandboxDir,
	});

	if (rawArgs[0] === "hook") {
		const code = await runHookCommand(writeErr);
		process.exit(code);
	}
	if (rawArgs[0] === "dev") {
		const code = await runDevCommand(rawArgs, { writeln, writeErr });
		process.exit(code);
	}
	if (rawArgs[0] === "version") {
		showVersion();
		process.exit(0);
	}
	if (rawArgs[0] === "update") {
		const { runRpcStopCommand } = await import("./commands/rpc");
		runRpcStopCommand(rawArgs, writeln, writeErr).catch(() => {});
		writeErr(
			"update command is not implemented yet (use your package manager to update manually)",
		);
		process.exit(1);
	}
	if (rawArgs[0] === "rpc") {
		const {
			runRpcEnsureCommand,
			runRpcRegisterCommand,
			runRpcStartCommand,
			runRpcStatusCommand,
			runRpcStopCommand,
		} = await import("./commands/rpc");
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
		const providerSettingsManager = await createProviderSettingsManager();
		const parsedAuthArgs = parseAuthCommandArgs(rawArgs.slice(1));
		if (parsedAuthArgs.parseError) {
			writeErr(parsedAuthArgs.parseError);
			process.exit(1);
		}
		const code = await runAuthCommand({
			providerSettingsManager,
			explicitProvider: parsedAuthArgs.explicitProvider,
			apikey: parsedAuthArgs.apikey,
			modelid: parsedAuthArgs.modelid,
			baseurl: parsedAuthArgs.baseurl,
			io: { writeln, writeErr },
		});
		process.exit(code);
	}
	let resumeSessionId: string | undefined;
	if (rawArgs[0] === "schedule") {
		const code = await runScheduleCommand(rawArgs, { writeln, writeErr });
		process.exit(code);
	}
	if (rawArgs[0] === "history") {
		const { runHistoryCommand } = await import("./commands/history");
		const result = await runHistoryCommand({
			rawArgs,
			outputMode: args.outputMode,
		});
		if (typeof result === "string") {
			resumeSessionId = result;
			args = {
				...args,
				interactive: true,
				prompt: undefined,
			};
		} else {
			process.exit(result);
		}
	}
	if (rawArgs[0] === "sessions") {
		const { runSessionsCommand } = await import("./commands/sessions");
		const code = await runSessionsCommand({
			rawArgs,
			io: { writeln, writeErr },
		});
		process.exit(code);
	}

	if (rawArgs[0] === "list") {
		const { runListCommand } = await import("./commands/list");
		setCurrentOutputMode(args.outputMode);
		const listCwd = resolveWorkspaceRoot(cwd);
		const code = await runListCommand({
			rawArgs,
			cwd: listCwd,
			outputMode: args.outputMode,
			io: { writeln, writeErr },
		});
		process.exit(code);
	}

	if (args.taskId !== undefined) {
		const sessionId = args.taskId.trim();
		if (!sessionId) {
			writeErr("--taskId requires <id>");
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
	if (launchConfigView) {
		args = {
			...args,
			interactive: true,
			prompt: undefined,
		};
	}

	if (args.invalidReasoningEffort) {
		writeErr(
			`invalid reasoning effort "${args.invalidReasoningEffort}" (expected "none", "low", "medium", "high", or "xhigh")`,
		);
		process.exit(1);
	}
	if (args.invalidTimeoutSeconds) {
		writeErr(
			`invalid timeout "${args.invalidTimeoutSeconds}" (expected integer >= 1)`,
		);
		process.exit(1);
	}
	if (args.invalidMaxConsecutiveMistakes) {
		writeln(
			`${c.dim}[warn] ignoring invalid --max-consecutive-mistakes value "${args.invalidMaxConsecutiveMistakes}" (expected integer >= 1)${c.reset}`,
		);
	}
	if (args.hooksDir?.trim()) {
		process.env.CLINE_HOOKS_DIR = args.hooksDir.trim();
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

	if (args.outputMode === "json" && (args.interactive || !args.prompt)) {
		writeErr(
			"JSON output mode requires a prompt argument or piped stdin (interactive mode is unsupported)",
		);
		process.exit(1);
	}

	// Keep command-style subcommands on a narrow path. Runtime-only imports pull
	// in provider resolution, config watchers, and session startup wiring that
	// should only load when the CLI is actually starting an agent session.
	const providerSettingsManager = await createProviderSettingsManager();
	const {
		coreServer: {
			createTeamName,
			createUserInstructionConfigWatcher,
			loadRulesForSystemPromptFromWatcher,
		},
		llms: { providers },
		resolveSystemPrompt,
		runAgent,
	} = await loadCliRuntimeModules();

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
			args.provider?.trim() || lastUsedProviderSettings?.provider || "cline",
		);
		let selectedProviderSettings =
			providerSettingsManager.getProviderSettings(provider);
		const persistedApiKey = getPersistedProviderApiKey(
			provider,
			selectedProviderSettings,
		);
		const providedApiKey = args.key?.trim() || undefined;
		let apiKey = providedApiKey || persistedApiKey || undefined;

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
		const effectiveReasoningEffort =
			args.reasoningEffort ?? (args.thinking ? "medium" : "none");
		const loggerAdapter = createCliLoggerAdapter({
			runtime: "cli",
			component: "main",
		});
		loggerAdapter.core?.info?.("CLI run started", {
			interactive: args.interactive === true,
			hasPrompt: !!args.prompt?.trim(),
			cwd,
		});

		const config: Config = {
			providerId: provider,
			modelId:
				args.model ??
				selectedProviderSettings?.model ??
				knownModelIds[0] ??
				"anthropic/claude-sonnet-4.6",
			apiKey: apiKey ?? "",
			knownModels,
			systemPrompt: await resolveSystemPrompt({
				cwd,
				explicitSystemPrompt: args.systemPrompt,
				providerId: provider,
				rules: loadRulesForSystemPromptFromWatcher(userInstructionWatcher),
			}),
			maxIterations: args.maxIterations,
			maxConsecutiveMistakes: args.maxConsecutiveMistakes ?? 3,
			timeoutSeconds: args.timeoutSeconds,
			sandbox: sandboxEnabled,
			sandboxDataDir,
			showUsage: args.showUsage,
			showTimings: args.showTimings,
			verbose: args.verbose,
			thinking: effectiveReasoningEffort === "none" ? false : args.thinking,
			reasoningEffort:
				effectiveReasoningEffort === "none"
					? undefined
					: effectiveReasoningEffort,
			outputMode: args.outputMode,
			mode: args.mode,
			logger: loggerAdapter.core,
			loggerConfig: loggerAdapter.runtimeConfig,
			defaultToolAutoApprove,
			toolPolicies,
			enableSpawnAgent: args.enableSpawnAgent,
			enableAgentTeams: args.enableAgentTeams,
			enableTools: args.enableTools,
			cwd,
			workspaceRoot: resolveWorkspaceRoot(cwd),
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
				// Persist explicit `-k/--key` even for OAuth-capable providers.
				providedApiKey
					? { apiKey: providedApiKey }
					: apiKey && !isOAuthProvider(provider)
						? { apiKey }
						: {};
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

		// Interactive mode
		if (args.interactive || !args.prompt) {
			const runInteractive = await loadInteractiveRuntimeModule();
			await runInteractive(config, userInstructionWatcher, resumeSessionId, {
				clineApiBaseUrl: selectedProviderSettings?.baseUrl,
				clineProviderSettings: selectedProviderSettings,
				initialView: launchConfigView ? "config" : "chat",
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
