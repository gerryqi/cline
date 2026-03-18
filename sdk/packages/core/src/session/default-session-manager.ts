import { existsSync, readFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import {
	Agent,
	type AgentConfig,
	type AgentEvent,
	type AgentResult,
	createSpawnAgentTool,
	type TeamEvent,
	type Tool,
	type ToolApprovalRequest,
	type ToolApprovalResult,
} from "@clinebot/agents";
import type { providers as LlmsProviders } from "@clinebot/llms";
import { formatUserInputBlock, normalizeUserInput } from "@clinebot/shared";
import { setHomeDirIfUnset } from "@clinebot/shared/storage";
import { nanoid } from "nanoid";
import { resolveAndLoadAgentPlugins } from "../agents/plugin-config-loader";
import {
	createBuiltinTools,
	type ToolExecutors,
	ToolPresets,
} from "../default-tools";
import { enrichPromptWithMentions } from "../input";
import {
	createHookAuditHooks,
	createHookConfigFileHooks,
	mergeAgentHooks,
} from "../runtime/hook-file-hooks";
import { DefaultRuntimeBuilder } from "../runtime/runtime-builder";
import type { BuiltRuntime, RuntimeBuilder } from "../runtime/session-runtime";
import { ProviderSettingsManager } from "../storage/provider-settings-manager";
import {
	buildTeamProgressSummary,
	toTeamProgressLifecycleEvent,
} from "../team";
import { SessionSource, type SessionStatus } from "../types/common";
import type { CoreSessionConfig } from "../types/config";
import type { CoreSessionEvent } from "../types/events";
import {
	type ProviderSettings,
	toProviderConfig,
} from "../types/provider-settings";
import type { SessionRecord } from "../types/sessions";
import type { RpcCoreSessionService } from "./rpc-session-service";
import {
	OAuthReauthRequiredError,
	type RuntimeOAuthResolution,
	RuntimeOAuthTokenManager,
} from "./runtime-oauth-token-manager";
import { nowIso } from "./session-artifacts";
import type {
	SendSessionInput,
	SessionManager,
	StartSessionInput,
	StartSessionResult,
} from "./session-manager";
import { SessionManifestSchema } from "./session-manifest";
import type {
	CoreSessionService,
	RootSessionArtifacts,
	SessionRowShape,
} from "./session-service";

type SessionBackend = CoreSessionService | RpcCoreSessionService;

type ActiveSession = {
	sessionId: string;
	config: CoreSessionConfig;
	artifacts?: RootSessionArtifacts;
	source: SessionSource;
	startedAt: string;
	pendingPrompt?: string;
	runtime: BuiltRuntime;
	agent: Agent;
	started: boolean;
	aborting: boolean;
	interactive: boolean;
	activeTeamRunIds: Set<string>;
	pendingTeamRunUpdates: TeamRunUpdate[];
	teamRunWaiters: Array<() => void>;
	pluginSandboxShutdown?: () => Promise<void>;
};

type TeamRunUpdate = {
	runId: string;
	agentId: string;
	taskId?: string;
	status: "completed" | "failed" | "cancelled" | "interrupted";
	error?: string;
	iterations?: number;
};

type StoredMessageWithMetadata = LlmsProviders.MessageWithMetadata & {
	providerId?: string;
	modelId?: string;
};

type PreparedTurnInput = {
	prompt: string;
	userImages?: string[];
	userFiles?: string[];
};

const WORKSPACE_CONFIGURATION_MARKER = "# Workspace Configuration";

function extractWorkspaceMetadataFromSystemPrompt(
	systemPrompt: string,
): string | undefined {
	const markerIndex = systemPrompt.lastIndexOf(WORKSPACE_CONFIGURATION_MARKER);
	if (markerIndex < 0) {
		return undefined;
	}
	const metadata = systemPrompt.slice(markerIndex).trim();
	return metadata.length > 0 ? metadata : undefined;
}

export interface DefaultSessionManagerOptions {
	distinctId: string;
	sessionService: SessionBackend;
	runtimeBuilder?: RuntimeBuilder;
	createAgent?: (config: AgentConfig) => Agent;
	defaultToolExecutors?: Partial<ToolExecutors>;
	toolPolicies?: AgentConfig["toolPolicies"];
	providerSettingsManager?: ProviderSettingsManager;
	oauthTokenManager?: RuntimeOAuthTokenManager;
	requestToolApproval?: (
		request: ToolApprovalRequest,
	) => Promise<ToolApprovalResult>;
}

const MAX_SCAN_LIMIT = 5000;
const MAX_USER_FILE_BYTES = 20 * 1_000 * 1_024;

async function loadUserFileContent(path: string): Promise<string> {
	const fileStat = await stat(path);
	if (!fileStat.isFile()) {
		throw new Error("Path is not a file");
	}
	if (fileStat.size > MAX_USER_FILE_BYTES) {
		throw new Error("File is too large to read into context.");
	}
	const content = await readFile(path, "utf8");
	if (content.includes("\u0000")) {
		throw new Error("Cannot read binary file into context.");
	}
	return content;
}

function hasRuntimeHooks(hooks: AgentConfig["hooks"]): boolean {
	if (!hooks) {
		return false;
	}
	return Object.values(hooks).some((value) => typeof value === "function");
}

function mergeAgentExtensions(
	explicitExtensions: AgentConfig["extensions"] | undefined,
	loadedExtensions: AgentConfig["extensions"] | undefined,
): AgentConfig["extensions"] {
	const merged = [...(explicitExtensions ?? []), ...(loadedExtensions ?? [])];
	if (merged.length === 0) {
		return undefined;
	}
	const deduped: NonNullable<AgentConfig["extensions"]> = [];
	const seenNames = new Set<string>();
	for (const extension of merged) {
		if (seenNames.has(extension.name)) {
			continue;
		}
		seenNames.add(extension.name);
		deduped.push(extension);
	}
	return deduped;
}

function serializeAgentEvent(event: AgentEvent): string {
	return JSON.stringify(event, (_key, value) => {
		if (value instanceof Error) {
			return {
				name: value.name,
				message: value.message,
				stack: value.stack,
			};
		}
		return value;
	});
}

function withLatestAssistantTurnMetadata(
	messages: LlmsProviders.Message[],
	result: AgentResult,
): StoredMessageWithMetadata[] {
	const next = messages.map((message) => ({
		...message,
	})) as StoredMessageWithMetadata[];
	const assistantIndex = [...next]
		.reverse()
		.findIndex((message) => message.role === "assistant");
	if (assistantIndex === -1) {
		return next;
	}

	const targetIndex = next.length - 1 - assistantIndex;
	const target = next[targetIndex];
	const usage = result.usage;
	next[targetIndex] = {
		...target,
		providerId: target.providerId ?? result.model.provider,
		modelId: target.modelId ?? result.model.id,
		modelInfo: target.modelInfo ?? {
			id: result.model.id,
			provider: result.model.provider,
		},
		metrics: {
			...(target.metrics ?? {}),
			inputTokens: usage.inputTokens,
			outputTokens: usage.outputTokens,
			cacheReadTokens: usage.cacheReadTokens,
			cacheWriteTokens: usage.cacheWriteTokens,
			cost: usage.totalCost,
		},
		ts: target.ts ?? result.endedAt.getTime(),
	};
	return next;
}

function toSessionRecord(row: SessionRowShape): SessionRecord {
	const metadata =
		typeof row.metadata_json === "string" && row.metadata_json.trim().length > 0
			? (() => {
					try {
						const parsed = JSON.parse(row.metadata_json) as unknown;
						if (
							parsed &&
							typeof parsed === "object" &&
							!Array.isArray(parsed)
						) {
							return parsed as Record<string, unknown>;
						}
					} catch {
						// Ignore malformed metadata payloads.
					}
					return undefined;
				})()
			: undefined;
	return {
		sessionId: row.session_id,
		source: row.source as SessionSource,
		pid: row.pid,
		startedAt: row.started_at,
		endedAt: row.ended_at ?? null,
		exitCode: row.exit_code ?? null,
		status: row.status,
		interactive: row.interactive === 1,
		provider: row.provider,
		model: row.model,
		cwd: row.cwd,
		workspaceRoot: row.workspace_root,
		teamName: row.team_name ?? undefined,
		enableTools: row.enable_tools === 1,
		enableSpawn: row.enable_spawn === 1,
		enableTeams: row.enable_teams === 1,
		parentSessionId: row.parent_session_id ?? undefined,
		parentAgentId: row.parent_agent_id ?? undefined,
		agentId: row.agent_id ?? undefined,
		conversationId: row.conversation_id ?? undefined,
		isSubagent: row.is_subagent === 1,
		prompt: row.prompt ?? undefined,
		metadata,
		transcriptPath: row.transcript_path,
		hookPath: row.hook_path,
		messagesPath: row.messages_path ?? undefined,
		updatedAt: row.updated_at ?? nowIso(),
	};
}

export class DefaultSessionManager implements SessionManager {
	private readonly sessionService: SessionBackend;
	private readonly runtimeBuilder: RuntimeBuilder;
	private readonly createAgentInstance: (config: AgentConfig) => Agent;
	private readonly defaultToolExecutors?: Partial<ToolExecutors>;
	private readonly defaultToolPolicies?: AgentConfig["toolPolicies"];
	private readonly providerSettingsManager: ProviderSettingsManager;
	private readonly oauthTokenManager: RuntimeOAuthTokenManager;
	private readonly defaultRequestToolApproval?: (
		request: ToolApprovalRequest,
	) => Promise<ToolApprovalResult>;
	private readonly listeners = new Set<(event: CoreSessionEvent) => void>();
	private readonly sessions = new Map<string, ActiveSession>();

	constructor(options: DefaultSessionManagerOptions) {
		const homeDir = homedir();
		if (homeDir) setHomeDirIfUnset(homeDir);
		this.sessionService = options.sessionService;
		this.runtimeBuilder = options.runtimeBuilder ?? new DefaultRuntimeBuilder();
		this.createAgentInstance =
			options.createAgent ?? ((config) => new Agent(config));
		this.defaultToolExecutors = options.defaultToolExecutors;
		this.defaultToolPolicies = options.toolPolicies;
		this.providerSettingsManager =
			options.providerSettingsManager ?? new ProviderSettingsManager();
		this.oauthTokenManager =
			options.oauthTokenManager ??
			new RuntimeOAuthTokenManager({
				providerSettingsManager: this.providerSettingsManager,
			});
		this.defaultRequestToolApproval = options.requestToolApproval;
	}

	private resolveStoredProviderSettings(providerId: string): ProviderSettings {
		const stored = this.providerSettingsManager.getProviderSettings(providerId);
		if (stored) {
			return stored;
		}
		return {
			provider: providerId,
		};
	}

	private buildResolvedProviderConfig(
		config: CoreSessionConfig,
	): LlmsProviders.ProviderConfig {
		const settings = this.resolveStoredProviderSettings(config.providerId);
		const mergedSettings: ProviderSettings = {
			...settings,
			provider: config.providerId,
			model: config.modelId,
			apiKey: config.apiKey ?? settings.apiKey,
			baseUrl: config.baseUrl ?? settings.baseUrl,
			headers: config.headers ?? settings.headers,
			reasoning:
				typeof config.thinking === "boolean" ||
				typeof config.reasoningEffort === "string"
					? {
							...(settings.reasoning ?? {}),
							...(typeof config.thinking === "boolean"
								? { enabled: config.thinking }
								: {}),
							...(typeof config.reasoningEffort === "string"
								? { effort: config.reasoningEffort }
								: {}),
						}
					: settings.reasoning,
		};
		const providerConfig = toProviderConfig(mergedSettings);
		if (config.knownModels) {
			providerConfig.knownModels = config.knownModels;
		}
		return providerConfig;
	}

	async start(input: StartSessionInput): Promise<StartSessionResult> {
		const source = input.source ?? SessionSource.CLI;
		const startedAt = nowIso();
		const requestedSessionId = input.config.sessionId?.trim() ?? "";
		const sessionId =
			requestedSessionId.length > 0
				? requestedSessionId
				: `${Date.now()}_${nanoid(5)}`;
		const sessionsDir =
			((await this.invokeOptionalValue("ensureSessionsDir")) as
				| string
				| undefined) ?? "";
		if (!sessionsDir) {
			throw new Error(
				"session service method not available: ensureSessionsDir",
			);
		}
		const sessionDir = join(sessionsDir, sessionId);
		const transcriptPath = join(sessionDir, `${sessionId}.log`);
		const hookPath = join(sessionDir, `${sessionId}.hooks.jsonl`);
		const messagesPath = join(sessionDir, `${sessionId}.messages.json`);
		const manifestPath = join(sessionDir, `${sessionId}.json`);
		const manifest = SessionManifestSchema.parse({
			version: 1,
			session_id: sessionId,
			source,
			pid: process.pid,
			started_at: startedAt,
			status: "running",
			interactive: input.interactive === true,
			provider: input.config.providerId,
			model: input.config.modelId,
			cwd: input.config.cwd,
			workspace_root: input.config.workspaceRoot ?? input.config.cwd,
			team_name: input.config.teamName,
			enable_tools: input.config.enableTools,
			enable_spawn: input.config.enableSpawnAgent,
			enable_teams: input.config.enableAgentTeams,
			prompt: input.prompt?.trim() || undefined,
			messages_path: messagesPath,
		});

		const fileHooks = createHookConfigFileHooks({
			cwd: input.config.cwd,
			workspacePath: input.config.workspaceRoot ?? input.config.cwd,
			rootSessionId: sessionId,
			hookLogPath: hookPath,
			logger: input.config.logger,
		});
		const auditHooks = hasRuntimeHooks(input.config.hooks)
			? undefined
			: createHookAuditHooks({
					hookLogPath: hookPath,
					rootSessionId: sessionId,
					workspacePath: input.config.workspaceRoot ?? input.config.cwd,
				});
		const effectiveHooks = mergeAgentHooks([
			input.config.hooks,
			fileHooks,
			auditHooks,
		]);
		const loadedPlugins = await resolveAndLoadAgentPlugins({
			pluginPaths: input.config.pluginPaths,
			workspacePath: input.config.workspaceRoot ?? input.config.cwd,
			cwd: input.config.cwd,
		});
		const effectiveExtensions = mergeAgentExtensions(
			input.config.extensions,
			loadedPlugins.extensions,
		);
		const effectiveConfigBase: CoreSessionConfig = {
			...input.config,
			hooks: effectiveHooks,
			extensions: effectiveExtensions,
		};
		const providerConfig =
			this.buildResolvedProviderConfig(effectiveConfigBase);
		const effectiveConfig: CoreSessionConfig = {
			...effectiveConfigBase,
			providerConfig,
		};

		const runtime = this.runtimeBuilder.build({
			config: effectiveConfig,
			hooks: effectiveHooks,
			extensions: effectiveExtensions,
			logger: effectiveConfig.logger,
			onTeamEvent: (event: TeamEvent) => {
				void this.handleTeamEvent(sessionId, event);
				effectiveConfig.onTeamEvent?.(event);
			},
			createSpawnTool: () => this.createSpawnTool(effectiveConfig, sessionId),
			onTeamRestored: input.onTeamRestored,
			userInstructionWatcher: input.userInstructionWatcher,
			defaultToolExecutors:
				input.defaultToolExecutors ?? this.defaultToolExecutors,
		});
		const tools = [...runtime.tools, ...(effectiveConfig.extraTools ?? [])];
		const agent = this.createAgentInstance({
			providerId: providerConfig.providerId,
			modelId: providerConfig.modelId,
			apiKey: providerConfig.apiKey,
			baseUrl: providerConfig.baseUrl,
			headers: providerConfig.headers,
			knownModels: providerConfig.knownModels,
			providerConfig,
			thinking: effectiveConfig.thinking,
			reasoningEffort:
				effectiveConfig.reasoningEffort ?? providerConfig.reasoningEffort,
			systemPrompt: effectiveConfig.systemPrompt,
			maxIterations: effectiveConfig.maxIterations,
			maxConsecutiveMistakes: effectiveConfig.maxConsecutiveMistakes,
			tools,
			hooks: effectiveHooks,
			extensions: effectiveExtensions,
			hookErrorMode: effectiveConfig.hookErrorMode,
			initialMessages: input.initialMessages,
			userFileContentLoader: loadUserFileContent,
			toolPolicies: input.toolPolicies ?? this.defaultToolPolicies,
			requestToolApproval:
				input.requestToolApproval ?? this.defaultRequestToolApproval,
			onConsecutiveMistakeLimitReached:
				effectiveConfig.onConsecutiveMistakeLimitReached,
			completionGuard: runtime.completionGuard,
			logger: runtime.logger ?? effectiveConfig.logger,
			onEvent: (event: AgentEvent) => {
				this.emit({
					type: "agent_event",
					payload: {
						sessionId,
						event,
					},
				});
				this.emit({
					type: "chunk",
					payload: {
						sessionId,
						stream: "agent",
						chunk: serializeAgentEvent(event),
						ts: Date.now(),
					},
				});
			},
		});

		const active: ActiveSession = {
			sessionId,
			config: effectiveConfig,
			source,
			startedAt,
			pendingPrompt: manifest.prompt,
			runtime,
			agent,
			started: false,
			aborting: false,
			interactive: input.interactive === true,
			activeTeamRunIds: new Set<string>(),
			pendingTeamRunUpdates: [],
			teamRunWaiters: [],
			pluginSandboxShutdown: loadedPlugins.shutdown,
		};
		this.sessions.set(active.sessionId, active);
		this.emitStatus(active.sessionId, "running");

		let result: AgentResult | undefined;
		try {
			if (input.prompt?.trim()) {
				result = await this.runTurn(active, {
					prompt: input.prompt,
					userImages: input.userImages,
					userFiles: input.userFiles,
				});
				if (!active.interactive) {
					await this.finalizeSingleRun(active, result.finishReason);
				}
			}
		} catch (error) {
			await this.failSession(active);
			throw error;
		}

		return {
			sessionId,
			manifest,
			manifestPath,
			transcriptPath,
			hookPath,
			messagesPath,
			result,
		};
	}

	async send(input: SendSessionInput): Promise<AgentResult | undefined> {
		const session = this.sessions.get(input.sessionId);
		if (!session) {
			throw new Error(`session not found: ${input.sessionId}`);
		}
		try {
			const result = await this.runTurn(session, {
				prompt: input.prompt,
				userImages: input.userImages,
				userFiles: input.userFiles,
			});
			if (!session.interactive) {
				await this.finalizeSingleRun(session, result.finishReason);
			}
			return result;
		} catch (error) {
			await this.failSession(session);
			throw error;
		}
	}

	async abort(sessionId: string): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (!session) {
			return;
		}
		session.aborting = true;
		session.agent.abort();
	}

	async stop(sessionId: string): Promise<void> {
		const session = this.sessions.get(sessionId);
		if (!session) {
			return;
		}
		await this.shutdownSession(session, {
			status: "cancelled",
			exitCode: null,
			shutdownReason: "session_stop",
			endReason: "stopped",
		});
	}

	async dispose(reason = "session_manager_dispose"): Promise<void> {
		const sessions = [...this.sessions.values()];
		if (sessions.length === 0) {
			return;
		}
		await Promise.allSettled(
			sessions.map(async (session) => {
				await this.shutdownSession(session, {
					status: "cancelled",
					exitCode: null,
					shutdownReason: reason,
					endReason: "disposed",
				});
			}),
		);
	}

	async get(sessionId: string): Promise<SessionRecord | undefined> {
		const row = await this.getRow(sessionId);
		return row ? toSessionRecord(row) : undefined;
	}

	async list(limit = 200): Promise<SessionRecord[]> {
		const rows = await this.listRows(limit);
		return rows.map((row) => toSessionRecord(row));
	}

	async delete(sessionId: string): Promise<boolean> {
		if (this.sessions.has(sessionId)) {
			await this.stop(sessionId);
		}
		const result = await this.invoke<{ deleted: boolean }>(
			"deleteSession",
			sessionId,
		);
		return result.deleted;
	}

	async readTranscript(sessionId: string, maxChars?: number): Promise<string> {
		const row = await this.getRow(sessionId);
		if (!row?.transcript_path || !existsSync(row.transcript_path)) {
			return "";
		}
		const raw = readFileSync(row.transcript_path, "utf8");
		if (typeof maxChars === "number" && Number.isFinite(maxChars)) {
			return raw.slice(-Math.max(0, Math.floor(maxChars)));
		}
		return raw;
	}

	async readMessages(sessionId: string): Promise<LlmsProviders.Message[]> {
		const row = await this.getRow(sessionId);
		const messagesPath = row?.messages_path?.trim();
		if (!messagesPath || !existsSync(messagesPath)) {
			return [];
		}
		try {
			const raw = readFileSync(messagesPath, "utf8");
			if (!raw.trim()) {
				return [];
			}
			const parsed = JSON.parse(raw) as { messages?: unknown } | unknown[];
			const messages = Array.isArray(parsed)
				? parsed
				: Array.isArray((parsed as { messages?: unknown }).messages)
					? ((parsed as { messages: unknown[] }).messages ?? [])
					: [];
			return messages as LlmsProviders.Message[];
		} catch {
			return [];
		}
	}

	async readHooks(sessionId: string, limit = 200): Promise<unknown[]> {
		const row = await this.getRow(sessionId);
		if (!row?.hook_path || !existsSync(row.hook_path)) {
			return [];
		}
		const lines = readFileSync(row.hook_path, "utf8")
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.length > 0);
		const sliced = lines.slice(-Math.max(1, Math.floor(limit)));
		return sliced.map((line) => {
			try {
				return JSON.parse(line) as unknown;
			} catch {
				return { raw: line };
			}
		});
	}

	subscribe(listener: (event: CoreSessionEvent) => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	private async runTurn(
		session: ActiveSession,
		input: {
			prompt: string;
			userImages?: string[];
			userFiles?: string[];
		},
	): Promise<AgentResult> {
		const preparedInput = await this.prepareTurnInput(session, input);
		const prompt = preparedInput.prompt.trim();
		if (!prompt) {
			throw new Error("prompt cannot be empty");
		}
		await this.ensureSessionPersisted(session);
		await this.syncOAuthCredentials(session);

		let result = await this.executeAgentTurn(
			session,
			prompt,
			preparedInput.userImages,
			preparedInput.userFiles,
		);

		while (this.shouldAutoContinueTeamRuns(session, result.finishReason)) {
			const updates = await this.waitForTeamRunUpdates(session);
			if (updates.length === 0) {
				break;
			}
			const continuationPrompt = this.buildTeamRunContinuationPrompt(
				session,
				updates,
			);
			result = await this.executeAgentTurn(session, continuationPrompt);
		}

		return result;
	}

	private async executeAgentTurn(
		session: ActiveSession,
		prompt: string,
		userImages?: string[],
		userFiles?: string[],
	): Promise<AgentResult> {
		const shouldContinue =
			session.started || session.agent.getMessages().length > 0;
		const baselineMessages = session.agent.getMessages();
		const result = shouldContinue
			? await this.runWithAuthRetry(
					session,
					() => session.agent.continue(prompt, userImages, userFiles),
					baselineMessages,
				)
			: await this.runWithAuthRetry(
					session,
					() => session.agent.run(prompt, userImages, userFiles),
					baselineMessages,
				);
		session.started = true;
		const persistedMessages = withLatestAssistantTurnMetadata(
			result.messages,
			result,
		);
		await this.invoke<void>(
			"persistSessionMessages",
			session.sessionId,
			persistedMessages,
		);
		return result;
	}

	private async prepareTurnInput(
		session: ActiveSession,
		input: {
			prompt: string;
			userImages?: string[];
			userFiles?: string[];
		},
	): Promise<PreparedTurnInput> {
		const mentionBaseDir = session.config.workspaceRoot ?? session.config.cwd;
		const normalizedPrompt = normalizeUserInput(input.prompt).trim();
		if (!normalizedPrompt) {
			return {
				prompt: "",
				userImages: input.userImages,
				userFiles: this.resolveAbsoluteFilePaths(
					session.config.cwd,
					input.userFiles,
				),
			};
		}

		const enriched = await enrichPromptWithMentions(
			normalizedPrompt,
			mentionBaseDir,
		);
		const prompt = formatUserInputBlock(
			enriched.prompt,
			session.config.mode === "plan" ? "plan" : "act",
		);
		const explicitUserFiles = this.resolveAbsoluteFilePaths(
			session.config.cwd,
			input.userFiles,
		);
		const mentionedFiles = this.resolveAbsoluteFilePaths(
			mentionBaseDir,
			enriched.matchedFiles,
		);
		const mergedUserFiles = Array.from(
			new Set([...explicitUserFiles, ...mentionedFiles]),
		);

		return {
			prompt,
			userImages: input.userImages,
			userFiles: mergedUserFiles.length > 0 ? mergedUserFiles : undefined,
		};
	}

	private resolveAbsoluteFilePaths(cwd: string, paths?: string[]): string[] {
		if (!paths || paths.length === 0) {
			return [];
		}
		const resolved = paths
			.map((filePath) => filePath.trim())
			.filter((filePath) => filePath.length > 0)
			.map((filePath) =>
				isAbsolute(filePath) ? filePath : resolve(cwd, filePath),
			);
		return Array.from(new Set(resolved));
	}

	private async ensureSessionPersisted(session: ActiveSession): Promise<void> {
		if (session.artifacts) {
			return;
		}
		session.artifacts = (await this.invoke("createRootSessionWithArtifacts", {
			sessionId: session.sessionId,
			source: session.source,
			pid: process.pid,
			interactive: session.interactive,
			provider: session.config.providerId,
			model: session.config.modelId,
			cwd: session.config.cwd,
			workspaceRoot: session.config.workspaceRoot ?? session.config.cwd,
			teamName: session.config.teamName,
			enableTools: session.config.enableTools,
			enableSpawn: session.config.enableSpawnAgent,
			enableTeams: session.config.enableAgentTeams,
			prompt: session.pendingPrompt,
			startedAt: session.startedAt,
		})) as RootSessionArtifacts;
	}

	private async finalizeSingleRun(
		session: ActiveSession,
		finishReason: AgentResult["finishReason"],
	): Promise<void> {
		if (this.hasPendingTeamRunWork(session)) {
			return;
		}
		if (finishReason === "aborted" || session.aborting) {
			await this.shutdownSession(session, {
				status: "cancelled",
				exitCode: null,
				shutdownReason: "session_complete",
				endReason: finishReason,
			});
		} else {
			await this.shutdownSession(session, {
				status: "completed",
				exitCode: 0,
				shutdownReason: "session_complete",
				endReason: finishReason,
			});
		}
	}

	private async failSession(session: ActiveSession): Promise<void> {
		await this.shutdownSession(session, {
			status: "failed",
			exitCode: 1,
			shutdownReason: "session_error",
			endReason: "error",
		});
	}

	private async shutdownSession(
		session: ActiveSession,
		input: {
			status: SessionStatus;
			exitCode: number | null;
			shutdownReason: string;
			endReason: string;
		},
	): Promise<void> {
		this.notifyTeamRunWaiters(session);
		if (session.artifacts) {
			await this.updateStatus(session, input.status, input.exitCode);
		}
		if (session.artifacts) {
			await session.agent.shutdown(input.shutdownReason);
		}
		await Promise.resolve(session.runtime.shutdown(input.shutdownReason));
		if (session.pluginSandboxShutdown) {
			await session.pluginSandboxShutdown();
		}
		this.sessions.delete(session.sessionId);
		this.emit({
			type: "ended",
			payload: {
				sessionId: session.sessionId,
				reason: input.endReason,
				ts: Date.now(),
			},
		});
	}

	private async updateStatus(
		session: ActiveSession,
		status: SessionStatus,
		exitCode?: number | null,
	): Promise<void> {
		if (!session.artifacts) {
			return;
		}
		const result = await this.invoke<{ updated: boolean; endedAt?: string }>(
			"updateSessionStatus",
			session.sessionId,
			status,
			exitCode,
		);
		if (!result.updated) {
			return;
		}
		session.artifacts.manifest.status = status;
		session.artifacts.manifest.ended_at = result.endedAt ?? nowIso();
		session.artifacts.manifest.exit_code =
			typeof exitCode === "number" ? exitCode : null;
		await this.invoke<void>(
			"writeSessionManifest",
			session.artifacts.manifestPath,
			session.artifacts.manifest,
		);
		this.emitStatus(session.sessionId, status);
	}

	private emitStatus(sessionId: string, status: string): void {
		this.emit({
			type: "status",
			payload: { sessionId, status },
		});
	}

	private async listRows(limit: number): Promise<SessionRowShape[]> {
		const normalizedLimit = Math.max(1, Math.floor(limit));
		return this.invoke<SessionRowShape[]>(
			"listSessions",
			Math.min(normalizedLimit, MAX_SCAN_LIMIT),
		);
	}

	private async getRow(
		sessionId: string,
	): Promise<SessionRowShape | undefined> {
		const target = sessionId.trim();
		if (!target) {
			return undefined;
		}
		const rows = await this.listRows(MAX_SCAN_LIMIT);
		return rows.find((row) => row.session_id === target);
	}

	private createSpawnTool(
		config: CoreSessionConfig,
		rootSessionId: string,
	): Tool {
		const createBaseTools = () => {
			if (!config.enableTools) {
				return [] as Tool[];
			}
			const preset =
				config.mode === "plan" ? ToolPresets.readonly : ToolPresets.development;
			return createBuiltinTools({
				cwd: config.cwd,
				...preset,
				executors: this.defaultToolExecutors,
			});
		};

		const createSubAgentTools = () => {
			const tools = createBaseTools();
			if (config.enableSpawnAgent) {
				tools.push(this.createSpawnTool(config, rootSessionId));
			}
			return tools;
		};

		return createSpawnAgentTool({
			providerId: config.providerId,
			modelId: config.modelId,
			cwd: config.cwd,
			apiKey: config.apiKey,
			baseUrl: config.baseUrl,
			providerConfig: config.providerConfig,
			knownModels: config.knownModels,
			clineWorkspaceMetadata:
				config.providerId === "cline"
					? extractWorkspaceMetadataFromSystemPrompt(config.systemPrompt)
					: undefined,
			createSubAgentTools,
			hooks: config.hooks,
			extensions: config.extensions,
			toolPolicies: this.defaultToolPolicies,
			requestToolApproval: this.defaultRequestToolApproval,
			logger: config.logger,
			onSubAgentStart: (context) => {
				void this.invokeOptional("handleSubAgentStart", rootSessionId, context);
			},
			onSubAgentEnd: (context) => {
				void this.invokeOptional("handleSubAgentEnd", rootSessionId, context);
			},
		}) as Tool;
	}

	private async handleTeamEvent(
		rootSessionId: string,
		event: TeamEvent,
	): Promise<void> {
		const session = this.sessions.get(rootSessionId);
		if (session) {
			switch (event.type) {
				case "run_queued":
				case "run_started":
					session.activeTeamRunIds.add(event.run.id);
					break;
				case "run_completed":
				case "run_failed":
				case "run_cancelled":
				case "run_interrupted": {
					let runError: string | undefined;
					if (event.type === "run_failed") {
						runError = event.run.error;
					} else if (event.type === "run_cancelled") {
						runError = event.run.error ?? event.reason;
					} else if (event.type === "run_interrupted") {
						runError = event.run.error ?? event.reason;
					}
					session.activeTeamRunIds.delete(event.run.id);
					session.pendingTeamRunUpdates.push({
						runId: event.run.id,
						agentId: event.run.agentId,
						taskId: event.run.taskId,
						status: event.type.replace("run_", "") as TeamRunUpdate["status"],
						error: runError,
						iterations: event.run.result?.iterations,
					});
					this.notifyTeamRunWaiters(session);
					break;
				}
				default:
					break;
			}
		}

		switch (event.type) {
			case "task_start":
				await this.invokeOptional(
					"onTeamTaskStart",
					rootSessionId,
					event.agentId,
					event.message,
				);
				break;
			case "task_end":
				if (event.error) {
					await this.invokeOptional(
						"onTeamTaskEnd",
						rootSessionId,
						event.agentId,
						"failed",
						`[error] ${event.error.message}`,
					);
					break;
				}
				if (event.result?.finishReason === "aborted") {
					await this.invokeOptional(
						"onTeamTaskEnd",
						rootSessionId,
						event.agentId,
						"cancelled",
						"[done] aborted",
						event.result.messages,
					);
					break;
				}
				await this.invokeOptional(
					"onTeamTaskEnd",
					rootSessionId,
					event.agentId,
					"completed",
					`[done] ${event.result?.finishReason ?? "completed"}`,
					event.result?.messages,
				);
				break;
			default:
				break;
		}

		if (!session?.runtime.teamRuntime) {
			return;
		}
		const teamName = session.config.teamName?.trim() || "team";
		this.emit({
			type: "team_progress",
			payload: {
				sessionId: rootSessionId,
				teamName,
				lifecycle: toTeamProgressLifecycleEvent({
					teamName,
					sessionId: rootSessionId,
					event,
				}),
				summary: buildTeamProgressSummary(
					teamName,
					session.runtime.teamRuntime.exportState(),
				),
			},
		});
	}

	private hasPendingTeamRunWork(session: ActiveSession): boolean {
		return (
			session.activeTeamRunIds.size > 0 ||
			session.pendingTeamRunUpdates.length > 0
		);
	}

	private shouldAutoContinueTeamRuns(
		session: ActiveSession,
		finishReason: AgentResult["finishReason"],
	): boolean {
		if (
			session.aborting ||
			finishReason === "aborted" ||
			finishReason === "error"
		) {
			return false;
		}
		if (!session.config.enableAgentTeams) {
			return false;
		}
		return this.hasPendingTeamRunWork(session);
	}

	private notifyTeamRunWaiters(session: ActiveSession): void {
		const waiters = session.teamRunWaiters.splice(0);
		for (const resolve of waiters) {
			resolve();
		}
	}

	private async waitForTeamRunUpdates(
		session: ActiveSession,
	): Promise<TeamRunUpdate[]> {
		while (true) {
			if (session.aborting) {
				return [];
			}
			if (session.pendingTeamRunUpdates.length > 0) {
				const updates = [...session.pendingTeamRunUpdates];
				session.pendingTeamRunUpdates.length = 0;
				return updates;
			}
			if (session.activeTeamRunIds.size === 0) {
				return [];
			}
			await new Promise<void>((resolve) => {
				session.teamRunWaiters.push(resolve);
			});
		}
	}

	private buildTeamRunContinuationPrompt(
		session: ActiveSession,
		updates: TeamRunUpdate[],
	): string {
		const lines = updates.map((update) => {
			const base = `- ${update.runId} (${update.agentId}) -> ${update.status}`;
			const task = update.taskId ? ` task=${update.taskId}` : "";
			const iterations =
				typeof update.iterations === "number"
					? ` iterations=${update.iterations}`
					: "";
			const error = update.error ? ` error=${update.error}` : "";
			return `${base}${task}${iterations}${error}`;
		});
		const remaining = session.activeTeamRunIds.size;
		const instruction =
			remaining > 0
				? `There are still ${remaining} teammate run(s) in progress. Continue coordination and decide whether to wait for more updates.`
				: "No teammate runs are currently in progress. Continue coordination using these updates.";
		return formatUserInputBlock(
			`System-delivered teammate async run updates:\n${lines.join("\n")}\n\n${instruction}`,
			session.config.mode === "plan" ? "plan" : "act",
		);
	}

	private emit(event: CoreSessionEvent): void {
		for (const listener of this.listeners) {
			listener(event);
		}
	}

	private async invoke<T>(method: string, ...args: unknown[]): Promise<T> {
		const callable = (
			this.sessionService as unknown as Record<string, unknown>
		)[method];
		if (typeof callable !== "function") {
			throw new Error(`session service method not available: ${method}`);
		}
		const fn = callable as (...params: unknown[]) => T | Promise<T>;
		return Promise.resolve(fn.apply(this.sessionService, args));
	}

	private async invokeOptional(
		method: string,
		...args: unknown[]
	): Promise<void> {
		const callable = (
			this.sessionService as unknown as Record<string, unknown>
		)[method];
		if (typeof callable !== "function") {
			return;
		}
		const fn = callable as (...params: unknown[]) => unknown;
		await Promise.resolve(fn.apply(this.sessionService, args));
	}

	private async invokeOptionalValue<T = unknown>(
		method: string,
		...args: unknown[]
	): Promise<T | undefined> {
		const callable = (
			this.sessionService as unknown as Record<string, unknown>
		)[method];
		if (typeof callable !== "function") {
			return undefined;
		}
		const fn = callable as (...params: unknown[]) => T | Promise<T>;
		return await Promise.resolve(fn.apply(this.sessionService, args));
	}

	private async runWithAuthRetry(
		session: ActiveSession,
		run: () => Promise<AgentResult>,
		baselineMessages: LlmsProviders.Message[],
	): Promise<AgentResult> {
		try {
			return await run();
		} catch (error) {
			if (!this.isLikelyAuthError(error, session.config.providerId)) {
				throw error;
			}

			await this.syncOAuthCredentials(session, { forceRefresh: true });
			session.agent.restore(baselineMessages);
			return run();
		}
	}

	private isLikelyAuthError(error: unknown, providerId: string): boolean {
		if (
			providerId !== "cline" &&
			providerId !== "oca" &&
			providerId !== "openai-codex"
		) {
			return false;
		}
		const message =
			error instanceof Error ? error.message.toLowerCase() : String(error);
		return (
			message.includes("401") ||
			message.includes("403") ||
			message.includes("unauthorized") ||
			message.includes("forbidden") ||
			message.includes("invalid token") ||
			message.includes("expired token") ||
			message.includes("authentication")
		);
	}

	private async syncOAuthCredentials(
		session: ActiveSession,
		options?: { forceRefresh?: boolean },
	): Promise<void> {
		let resolved: RuntimeOAuthResolution | null = null;
		try {
			resolved = await this.oauthTokenManager.resolveProviderApiKey({
				providerId: session.config.providerId,
				forceRefresh: options?.forceRefresh,
			});
		} catch (error) {
			if (error instanceof OAuthReauthRequiredError) {
				throw new Error(
					`OAuth session for "${error.providerId}" requires re-authentication. Run "clite auth ${error.providerId}" and retry.`,
				);
			}
			throw error;
		}
		if (!resolved?.apiKey) {
			return;
		}
		if (session.config.apiKey === resolved.apiKey) {
			return;
		}
		session.config.apiKey = resolved.apiKey;
		const agentWithConnection = session.agent as Agent & {
			updateConnection?: (overrides: { apiKey?: string }) => void;
		};
		agentWithConnection.updateConnection?.({ apiKey: resolved.apiKey });
		// Propagate refreshed credentials to all active teammate agents
		session.runtime.teamRuntime?.updateTeammateConnections({
			apiKey: resolved.apiKey,
		});
	}
}
