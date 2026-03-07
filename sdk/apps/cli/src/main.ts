import { homedir } from "node:os";
import {
	createTeamName,
	createUserInstructionConfigWatcher,
	loadRulesForSystemPromptFromWatcher,
	migrateLegacyProviderSettings,
	ProviderSettingsManager,
} from "@cline/core/server";
import { providers } from "@cline/llms";
import type { ToolPolicy } from "@cline/shared";
import { setHomeDir } from "@cline/shared/storage";
import {
	ensureOAuthProviderApiKey,
	getPersistedProviderApiKey,
	isOAuthProvider,
	normalizeProviderId,
	parseAuthCommandArgs,
	runAuthCommand,
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
import { showHelp, showVersion } from "./help";
import { resolveSystemPrompt } from "./runtime/prompt";
import { runAgent } from "./runtime/run-agent";
import { runInteractive } from "./runtime/run-interactive";
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
import { deleteSession, listSessions } from "./utils/session";
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

export async function runCli(): Promise<void> {
	setHomeDir(homedir());
	installStreamErrorGuards();

	const rawArgs = process.argv.slice(2);
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
	if (launchConfigView) {
		args = {
			...args,
			interactive: true,
			prompt: undefined,
		};
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
			systemPrompt: await resolveSystemPrompt({
				cwd,
				explicitSystemPrompt: args.systemPrompt,
				rules: loadRulesForSystemPromptFromWatcher(userInstructionWatcher),
			}),
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
