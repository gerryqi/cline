import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
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
} from "@cline/agents";
import type { providers as LlmsProviders } from "@cline/llms";
import { setHomeDirIfUnset } from "@cline/shared";
import {
	createBuiltinTools,
	type ToolExecutors,
	ToolPresets,
} from "../default-tools";
import {
	createHookAuditHooks,
	createHookConfigFileHooks,
	mergeAgentHooks,
} from "../runtime/hook-file-hooks";
import { DefaultRuntimeBuilder } from "../runtime/runtime-builder";
import type { BuiltRuntime, RuntimeBuilder } from "../runtime/session-runtime";
import type { ProviderSettingsManager } from "../storage/provider-settings-manager";
import { SessionSource, type SessionStatus } from "../types/common";
import type { CoreSessionConfig } from "../types/config";
import type { CoreSessionEvent } from "../types/events";
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
import type {
	CoreSessionService,
	RootSessionArtifacts,
	SessionRowShape,
} from "./session-service";

type SessionBackend = CoreSessionService | RpcCoreSessionService;

type ActiveSession = {
	sessionId: string;
	config: CoreSessionConfig;
	artifacts: RootSessionArtifacts;
	runtime: BuiltRuntime;
	agent: Agent;
	started: boolean;
	aborting: boolean;
	interactive: boolean;
};

export interface DefaultSessionManagerOptions {
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

function hasRuntimeHooks(hooks: AgentConfig["hooks"]): boolean {
	if (!hooks) {
		return false;
	}
	return Object.values(hooks).some((value) => typeof value === "function");
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

function toSessionRecord(row: SessionRowShape): SessionRecord {
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
		this.oauthTokenManager =
			options.oauthTokenManager ??
			new RuntimeOAuthTokenManager({
				providerSettingsManager: options.providerSettingsManager,
			});
		this.defaultRequestToolApproval = options.requestToolApproval;
	}

	async start(input: StartSessionInput): Promise<StartSessionResult> {
		const sessionId = input.config.sessionId?.trim() ?? "";
		const artifacts = (await this.invoke("createRootSessionWithArtifacts", {
			sessionId,
			source: input.source ?? SessionSource.CLI,
			pid: process.pid,
			interactive: input.interactive === true,
			provider: input.config.providerId,
			model: input.config.modelId,
			cwd: input.config.cwd,
			workspaceRoot: input.config.workspaceRoot ?? input.config.cwd,
			teamName: input.config.teamName,
			enableTools: input.config.enableTools,
			enableSpawn: input.config.enableSpawnAgent,
			enableTeams: input.config.enableAgentTeams,
			prompt: input.prompt?.trim() || undefined,
			startedAt: nowIso(),
		})) as RootSessionArtifacts;

		const fileHooks = createHookConfigFileHooks({
			cwd: input.config.cwd,
			workspacePath: input.config.workspaceRoot ?? input.config.cwd,
			rootSessionId: artifacts.manifest.session_id,
			hookLogPath: artifacts.hookPath,
			logger: input.config.logger,
		});
		const auditHooks = hasRuntimeHooks(input.config.hooks)
			? undefined
			: createHookAuditHooks({
					hookLogPath: artifacts.hookPath,
					rootSessionId: artifacts.manifest.session_id,
					workspacePath: input.config.workspaceRoot ?? input.config.cwd,
				});
		const effectiveHooks = mergeAgentHooks([
			input.config.hooks,
			fileHooks,
			auditHooks,
		]);
		const effectiveConfig: CoreSessionConfig = {
			...input.config,
			hooks: effectiveHooks,
		};

		const runtime = this.runtimeBuilder.build({
			config: effectiveConfig,
			hooks: effectiveHooks,
			logger: effectiveConfig.logger,
			onTeamEvent: (event: TeamEvent) => {
				void this.handleTeamEvent(artifacts.manifest.session_id, event);
				effectiveConfig.onTeamEvent?.(event);
			},
			createSpawnTool: () =>
				this.createSpawnTool(effectiveConfig, artifacts.manifest.session_id),
			onTeamRestored: input.onTeamRestored,
			userInstructionWatcher: input.userInstructionWatcher,
			defaultToolExecutors:
				input.defaultToolExecutors ?? this.defaultToolExecutors,
		});
		const tools = [...runtime.tools, ...(effectiveConfig.extraTools ?? [])];
		const agent = this.createAgentInstance({
			providerId: effectiveConfig.providerId,
			modelId: effectiveConfig.modelId,
			apiKey: effectiveConfig.apiKey,
			baseUrl: effectiveConfig.baseUrl,
			knownModels: effectiveConfig.knownModels,
			thinking: effectiveConfig.thinking,
			systemPrompt: effectiveConfig.systemPrompt,
			maxIterations: effectiveConfig.maxIterations,
			tools,
			hooks: effectiveHooks,
			hookErrorMode: effectiveConfig.hookErrorMode,
			initialMessages: input.initialMessages,
			toolPolicies: input.toolPolicies ?? this.defaultToolPolicies,
			requestToolApproval:
				input.requestToolApproval ?? this.defaultRequestToolApproval,
			logger: runtime.logger ?? effectiveConfig.logger,
			onEvent: (event: AgentEvent) => {
				this.emit({
					type: "agent_event",
					payload: {
						sessionId: artifacts.manifest.session_id,
						event,
					},
				});
				this.emit({
					type: "chunk",
					payload: {
						sessionId: artifacts.manifest.session_id,
						stream: "agent",
						chunk: serializeAgentEvent(event),
						ts: Date.now(),
					},
				});
			},
		});

		const active: ActiveSession = {
			sessionId: artifacts.manifest.session_id,
			config: effectiveConfig,
			artifacts,
			runtime,
			agent,
			started: false,
			aborting: false,
			interactive: input.interactive === true,
		};
		active.started = (input.initialMessages?.length ?? 0) > 0;
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
			sessionId: active.sessionId,
			manifest: artifacts.manifest,
			manifestPath: artifacts.manifestPath,
			transcriptPath: artifacts.transcriptPath,
			hookPath: artifacts.hookPath,
			messagesPath: artifacts.messagesPath,
			result,
		};
	}

	async send(input: SendSessionInput): Promise<AgentResult | undefined> {
		const session = this.sessions.get(input.sessionId);
		if (!session) {
			throw new Error(`session not found: ${input.sessionId}`);
		}
		try {
			const result = await this.runTurn(session, input);
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
		const prompt = input.prompt.trim();
		if (!prompt) {
			throw new Error("prompt cannot be empty");
		}
		await this.syncOAuthCredentials(session);

		const shouldContinue =
			session.started || session.agent.getMessages().length > 0;
		const baselineMessages = session.agent.getMessages();
		const result = shouldContinue
			? await this.runWithAuthRetry(
					session,
					() =>
						session.agent.continue(prompt, input.userImages, input.userFiles),
					baselineMessages,
				)
			: await this.runWithAuthRetry(
					session,
					() => session.agent.run(prompt, input.userImages, input.userFiles),
					baselineMessages,
				);
		session.started = true;

		await this.invoke<void>(
			"persistSessionMessages",
			session.sessionId,
			result.messages,
		);
		return result;
	}

	private async finalizeSingleRun(
		session: ActiveSession,
		finishReason: AgentResult["finishReason"],
	): Promise<void> {
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
		await this.updateStatus(session, input.status, input.exitCode);
		await session.agent.shutdown(input.shutdownReason);
		await Promise.resolve(session.runtime.shutdown(input.shutdownReason));
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

		return createSpawnAgentTool({
			providerId: config.providerId,
			modelId: config.modelId,
			apiKey: config.apiKey,
			baseUrl: config.baseUrl,
			knownModels: config.knownModels,
			defaultMaxIterations: config.maxIterations,
			createSubAgentTools: createBaseTools,
			hooks: config.hooks,
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
					return;
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
					return;
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
	}
}
