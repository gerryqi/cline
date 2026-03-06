import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { type AgentEvent, getClineDefaultSystemPrompt } from "@cline/agents";
import {
	ClineAccountService,
	CoreSessionService,
	createOAuthClientCallbacks,
	DefaultSessionManager,
	enrichPromptWithMentions,
	executeRpcClineAccountAction,
	generateWorkspaceInfo,
	isRpcClineAccountActionRequest,
	loginClineOAuth,
	loginOcaOAuth,
	loginOpenAICodex,
	ProviderSettingsManager,
	SessionSource,
	SqliteSessionStore,
} from "@cline/core/server";
import type { providers as LlmsProviders } from "@cline/llms";
import { models, providers } from "@cline/llms";
import { type RpcRuntimeHandlers, RpcSessionClient } from "@cline/rpc";
import {
	formatUserInputBlock,
	type RpcChatMessage,
	type RpcChatRunTurnRequest,
	type RpcChatStartSessionRequest,
	type RpcChatTurnResult,
	type RpcProviderActionRequest,
	type RpcProviderListItem,
	type RpcProviderModel,
	type RpcProviderSettingsActionRequest,
	setHomeDir,
	setHomeDirIfUnset,
} from "@cline/shared";

type OAuthProviderId = "cline" | "oca" | "openai-codex";

function toPromptMessage(
	message: string,
	mode: "act" | "plan" = "act",
): string {
	return formatUserInputBlock(message, mode);
}

function sanitizeFilename(name: string, index: number): string {
	const base = basename(name || `attachment-${index + 1}`);
	return base.replace(/[^\w.-]+/g, "_");
}

async function materializeUserFiles(
	files: Array<{ name: string; content: string }> | undefined,
): Promise<{ tempDir?: string; paths: string[] }> {
	if (!files || files.length === 0) {
		return { paths: [] };
	}

	const resolvedTempDir = await mkdtemp(`${tmpdir()}/cline-rpc-attachments-`);
	const paths: string[] = [];
	for (const [index, file] of files.entries()) {
		const safeName = sanitizeFilename(file.name, index);
		const path = join(resolvedTempDir, safeName);
		await writeFile(path, file.content, "utf8");
		paths.push(path);
	}
	return { tempDir: resolvedTempDir, paths };
}

async function resolveSystemPrompt(
	config: RpcChatStartSessionRequest,
	cwd: string,
): Promise<string> {
	const explicit = config.systemPrompt?.trim();
	if (explicit) {
		return explicit;
	}
	const workspaceInfo = await generateWorkspaceInfo(cwd);
	return getClineDefaultSystemPrompt(
		"Terminal Shell",
		cwd,
		JSON.stringify(workspaceInfo, null, 2),
	);
}

function resolveMode(config: RpcChatStartSessionRequest): "act" | "plan" {
	return config.mode === "plan" ? "plan" : "act";
}

function resolveSessionCwd(config: RpcChatStartSessionRequest): string {
	return (config.cwd?.trim() || config.workspaceRoot).trim();
}

function applyHomeDir(config: RpcChatStartSessionRequest): void {
	const homeDir = config.sessions?.homeDir?.trim();
	if (homeDir) {
		setHomeDir(homeDir);
		return;
	}
	setHomeDirIfUnset(homedir());
}

function parseStartPayload(requestJson: string): RpcChatStartSessionRequest {
	return JSON.parse(requestJson) as RpcChatStartSessionRequest;
}

function parseSendPayload(requestJson: string): RpcChatRunTurnRequest {
	return JSON.parse(requestJson) as RpcChatRunTurnRequest;
}

function toRpcMessages(messages: LlmsProviders.Message[]): RpcChatMessage[] {
	return messages as unknown as RpcChatMessage[];
}

function resolveVisibleApiKey(settings: {
	apiKey?: string;
	auth?: {
		apiKey?: string;
		accessToken?: string;
	};
}): string | undefined {
	return settings.apiKey ?? settings.auth?.apiKey ?? settings.auth?.accessToken;
}

function titleCaseFromId(id: string): string {
	return id
		.split(/[-_]/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

function createLetter(name: string): string {
	const parts = name
		.split(/\s+/)
		.map((part) => part.trim())
		.filter(Boolean);
	if (parts.length === 0) {
		return "?";
	}
	if (parts.length === 1) {
		return parts[0].slice(0, 2).toUpperCase();
	}
	return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function stableColor(id: string): string {
	const palette = [
		"#c4956a",
		"#6b8aad",
		"#e8963a",
		"#5b9bd5",
		"#6bbd7b",
		"#9b7dd4",
		"#d07f68",
		"#57a6a1",
	];
	let hash = 0;
	for (const ch of id) {
		hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
	}
	return palette[hash % palette.length];
}

async function listProviders(manager: ProviderSettingsManager): Promise<{
	providers: RpcProviderListItem[];
	settingsPath: string;
}> {
	const state = manager.read();
	const ids = models.getProviderIds().sort((a, b) => a.localeCompare(b));
	const providerItems = await Promise.all(
		ids.map(async (id): Promise<RpcProviderListItem> => {
			const info = await models.getProvider(id);
			const persistedSettings = state.providers[id]?.settings;
			const providerName = info?.name ?? titleCaseFromId(id);
			return {
				id,
				name: providerName,
				models: null,
				color: stableColor(id),
				letter: createLetter(providerName),
				enabled: Boolean(persistedSettings),
				apiKey: persistedSettings
					? resolveVisibleApiKey(persistedSettings)
					: undefined,
				baseUrl: persistedSettings?.baseUrl ?? info?.baseUrl,
				defaultModelId: info?.defaultModelId,
				authDescription: "This provider uses API keys for authentication.",
				baseUrlDescription: "The base endpoint to use for provider requests.",
			};
		}),
	);

	return {
		providers: providerItems,
		settingsPath: manager.getFilePath(),
	};
}

async function getProviderModels(
	providerId: string,
): Promise<{ providerId: string; models: RpcProviderModel[] }> {
	const id = providerId.trim();
	const modelMap = await models.getModelsForProvider(id);
	const items = Object.entries(modelMap)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([modelId, info]) => ({
			id: modelId,
			name: info.name ?? modelId,
			supportsAttachments: info.capabilities?.includes("files"),
			supportsVision: info.capabilities?.includes("images"),
		}));
	return {
		providerId: id,
		models: items,
	};
}

function saveProviderSettings(
	manager: ProviderSettingsManager,
	request: Extract<
		RpcProviderSettingsActionRequest,
		{ action: "saveProviderSettings" }
	>,
): { providerId: string; enabled: boolean; settingsPath: string } {
	const providerId = request.providerId.trim();
	const state = manager.read();

	if (request.enabled === false) {
		delete state.providers[providerId];
		if (state.lastUsedProvider === providerId) {
			delete state.lastUsedProvider;
		}
		manager.write(state);
		return {
			providerId,
			enabled: false,
			settingsPath: manager.getFilePath(),
		};
	}

	const existing = manager.getProviderSettings(providerId);
	const nextSettings: Record<string, unknown> = {
		...(existing ?? {}),
		provider: providerId,
	};

	if ("apiKey" in request) {
		const apiKey = request.apiKey?.trim() ?? "";
		if (apiKey.length === 0) {
			delete nextSettings.apiKey;
		} else {
			nextSettings.apiKey = request.apiKey;
		}
	}

	if ("baseUrl" in request) {
		const baseUrl = request.baseUrl?.trim() ?? "";
		if (baseUrl.length === 0) {
			delete nextSettings.baseUrl;
		} else {
			nextSettings.baseUrl = request.baseUrl;
		}
	}

	manager.saveProviderSettings(nextSettings, { setLastUsed: false });
	return {
		providerId,
		enabled: true,
		settingsPath: manager.getFilePath(),
	};
}

function normalizeOAuthProvider(provider: string): OAuthProviderId {
	const normalized = provider.trim().toLowerCase();
	if (normalized === "codex" || normalized === "openai-codex") {
		return "openai-codex";
	}
	if (normalized === "cline" || normalized === "oca") {
		return normalized;
	}
	throw new Error(
		`provider "${provider}" does not support OAuth login (supported: cline, oca, openai-codex)`,
	);
}

function openUrl(url: string): void {
	const platform = process.platform;
	const command =
		platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
	const args =
		platform === "darwin"
			? [url]
			: platform === "win32"
				? ["/c", "start", "", url]
				: [url];
	const child = spawn(command, args, {
		stdio: "ignore",
		detached: true,
	});
	child.unref();
}

function toProviderApiKey(
	providerId: OAuthProviderId,
	credentials: { access: string },
): string {
	if (providerId === "cline") {
		return `workos:${credentials.access}`;
	}
	return credentials.access;
}

async function loginProvider(
	providerId: OAuthProviderId,
	existing: LlmsProviders.ProviderSettings | undefined,
): Promise<{
	access: string;
	refresh: string;
	expires: number;
	accountId?: string;
}> {
	const callbacks = createOAuthClientCallbacks({
		onPrompt: async (prompt) => prompt.defaultValue ?? "",
		openUrl: (url) => openUrl(url),
		onOpenUrlError: ({ error }) => {
			throw error instanceof Error ? error : new Error(String(error));
		},
	});

	if (providerId === "cline") {
		return loginClineOAuth({
			apiBaseUrl: existing?.baseUrl?.trim() || "https://api.cline.bot",
			callbacks,
		});
	}
	if (providerId === "oca") {
		return loginOcaOAuth({
			mode: existing?.oca?.mode,
			callbacks,
		});
	}
	return loginOpenAICodex(callbacks);
}

function saveProviderOAuthCredentials(
	manager: ProviderSettingsManager,
	providerId: OAuthProviderId,
	existing: LlmsProviders.ProviderSettings | undefined,
	credentials: {
		access: string;
		refresh: string;
		expires: number;
		accountId?: string;
	},
): LlmsProviders.ProviderSettings {
	const auth = {
		...(existing?.auth ?? {}),
		accessToken: toProviderApiKey(providerId, credentials),
		refreshToken: credentials.refresh,
		accountId: credentials.accountId,
	} as LlmsProviders.ProviderSettings["auth"] & { expiresAt?: number };
	auth.expiresAt = credentials.expires;
	const merged: LlmsProviders.ProviderSettings = {
		...(existing ?? {
			provider: providerId as LlmsProviders.ProviderSettings["provider"],
		}),
		provider: providerId as LlmsProviders.ProviderSettings["provider"],
		auth,
	};
	manager.saveProviderSettings(merged, { tokenSource: "oauth" });
	return merged;
}

function resolveClineAuthToken(
	settings: LlmsProviders.ProviderSettings | undefined,
): string | undefined {
	const token = settings?.auth?.accessToken?.trim() || settings?.apiKey?.trim();
	return token && token.length > 0 ? token : undefined;
}

export function createRpcRuntimeHandlers(): RpcRuntimeHandlers {
	const sessionManager = new DefaultSessionManager({
		sessionService: new CoreSessionService(new SqliteSessionStore()),
	});
	const sessionModes = new Map<string, "act" | "plan">();
	const activeSessions = new Set<string>();
	const rpcAddress = process.env.CLINE_RPC_ADDRESS?.trim() || "127.0.0.1:4317";
	const eventClient = new RpcSessionClient({ address: rpcAddress });

	const publishRuntimeEvent = (
		sessionId: string,
		eventType: string,
		payload: unknown,
	): void => {
		const trimmedSessionId = sessionId.trim();
		if (!trimmedSessionId) {
			return;
		}
		void eventClient
			.publishEvent({
				sessionId: trimmedSessionId,
				eventType,
				payloadJson: JSON.stringify(payload),
				sourceClientId: "cli-rpc-runtime",
			})
			.catch(() => {
				// Best effort: runtime execution should not fail on event publish errors.
			});
	};

	const publishFromAgentEvent = (
		sessionId: string,
		event: AgentEvent,
	): void => {
		if (event.type === "content_start" && event.contentType === "text") {
			publishRuntimeEvent(sessionId, "runtime.chat.text_delta", {
				text: event.text ?? "",
				accumulated: event.accumulated,
			});
			return;
		}
		if (event.type === "content_start" && event.contentType === "tool") {
			publishRuntimeEvent(sessionId, "runtime.chat.tool_call_start", {
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				input: event.input,
			});
			return;
		}
		if (event.type === "content_end" && event.contentType === "tool") {
			publishRuntimeEvent(sessionId, "runtime.chat.tool_call_end", {
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				output: event.output,
				error: event.error,
				durationMs: event.durationMs,
			});
		}
	};

	sessionManager.subscribe((coreEvent) => {
		if (coreEvent.type === "agent_event") {
			const sessionId = coreEvent.payload.sessionId;
			const event = coreEvent.payload.event;
			publishFromAgentEvent(sessionId, event);
		}
	});

	return {
		startSession: async (requestJson) => {
			const config = parseStartPayload(requestJson);
			applyHomeDir(config);
			const mode = resolveMode(config);
			const cwd = resolveSessionCwd(config);
			const providerId = providers.normalizeProviderId(config.provider);
			const systemPrompt = await resolveSystemPrompt(config, cwd);
			const started = await sessionManager.start({
				source: SessionSource.DESKTOP_CHAT,
				interactive: true,
				initialMessages: config.initialMessages as
					| LlmsProviders.Message[]
					| undefined,
				config: {
					providerId,
					modelId: config.model,
					mode,
					apiKey: config.apiKey?.trim() || undefined,
					cwd,
					workspaceRoot: config.workspaceRoot,
					systemPrompt,
					maxIterations: config.maxIterations ?? 10,
					enableTools: config.enableTools,
					enableSpawnAgent: config.enableSpawn,
					enableAgentTeams: config.enableTeams,
					teamName: config.teamName,
					missionLogIntervalSteps: config.missionStepInterval,
					missionLogIntervalMs: config.missionTimeIntervalMs,
				},
				toolPolicies:
					(
						config as {
							toolPolicies?: Record<
								string,
								{ enabled?: boolean; autoApprove?: boolean }
							>;
						}
					).toolPolicies ??
					({
						"*": {
							autoApprove: config.autoApproveTools !== false,
						},
					} as Record<string, { enabled?: boolean; autoApprove?: boolean }>),
			});
			sessionModes.set(started.sessionId, mode);
			activeSessions.add(started.sessionId);
			return {
				sessionId: started.sessionId,
				startResultJson: JSON.stringify(started),
			};
		},
		sendSession: async (sessionId, requestJson) => {
			const request = parseSendPayload(requestJson);
			applyHomeDir(request.config);
			const mode =
				request.config.mode === "plan"
					? "plan"
					: (sessionModes.get(sessionId) ?? "act");
			const cwd = resolveSessionCwd(request.config);
			const input = request.promptPreformatted
				? request.prompt.trim()
				: toPromptMessage(
						(await enrichPromptWithMentions(request.prompt, cwd)).prompt,
						mode,
					);
			const userImages = request.attachments?.userImages ?? [];
			const fileMaterialized = await materializeUserFiles(
				request.attachments?.userFiles,
			);

			try {
				const result = await sessionManager.send({
					sessionId,
					prompt: input,
					userImages,
					userFiles: fileMaterialized.paths,
				});
				if (!result) {
					throw new Error("runtime send returned no result");
				}
				const output: RpcChatTurnResult = {
					text: result.text,
					usage: result.usage,
					inputTokens: result.usage.inputTokens,
					outputTokens: result.usage.outputTokens,
					iterations: result.iterations,
					finishReason: result.finishReason,
					messages: toRpcMessages(result.messages),
					toolCalls: result.toolCalls.map((call) => ({
						name: call.name,
						input: call.input,
						output: call.output,
						error: call.error,
						durationMs: call.durationMs,
					})),
				};
				return { resultJson: JSON.stringify(output) };
			} catch (error) {
				const message =
					error instanceof Error ? error.message : String(error ?? "");
				const shouldRestore = message.includes("session not found");
				if (!shouldRestore) {
					throw error;
				}

				const modeFromConfig = resolveMode(request.config);
				const providerId = providers.normalizeProviderId(
					request.config.provider,
				);
				const systemPrompt = await resolveSystemPrompt(request.config, cwd);
				await sessionManager.start({
					source: SessionSource.DESKTOP_CHAT,
					interactive: true,
					initialMessages: request.messages as unknown as
						| LlmsProviders.Message[]
						| undefined,
					config: {
						sessionId,
						providerId,
						modelId: request.config.model,
						mode: modeFromConfig,
						apiKey: request.config.apiKey?.trim() || undefined,
						cwd,
						workspaceRoot: request.config.workspaceRoot,
						systemPrompt,
						maxIterations: request.config.maxIterations ?? 10,
						enableTools: request.config.enableTools,
						enableSpawnAgent: request.config.enableSpawn,
						enableAgentTeams: request.config.enableTeams,
						teamName: request.config.teamName,
						missionLogIntervalSteps: request.config.missionStepInterval,
						missionLogIntervalMs: request.config.missionTimeIntervalMs,
					},
					toolPolicies:
						(
							request.config as {
								toolPolicies?: Record<
									string,
									{ enabled?: boolean; autoApprove?: boolean }
								>;
							}
						).toolPolicies ??
						({
							"*": {
								autoApprove: request.config.autoApproveTools !== false,
							},
						} as Record<string, { enabled?: boolean; autoApprove?: boolean }>),
				});
				sessionModes.set(sessionId, modeFromConfig);
				activeSessions.add(sessionId);
				const restoredResult = await sessionManager.send({
					sessionId,
					prompt: input,
					userImages,
					userFiles: fileMaterialized.paths,
				});
				if (!restoredResult) {
					throw new Error("runtime send returned no result after restore");
				}
				const output: RpcChatTurnResult = {
					text: restoredResult.text,
					usage: restoredResult.usage,
					inputTokens: restoredResult.usage.inputTokens,
					outputTokens: restoredResult.usage.outputTokens,
					iterations: restoredResult.iterations,
					finishReason: restoredResult.finishReason,
					messages: toRpcMessages(restoredResult.messages),
					toolCalls: restoredResult.toolCalls.map((call) => ({
						name: call.name,
						input: call.input,
						output: call.output,
						error: call.error,
						durationMs: call.durationMs,
					})),
				};
				return { resultJson: JSON.stringify(output) };
			} finally {
				if (fileMaterialized.tempDir) {
					try {
						await rm(fileMaterialized.tempDir, {
							recursive: true,
							force: true,
						});
					} catch {
						// best effort cleanup
					}
				}
			}
		},
		abortSession: async (sessionId) => {
			const id = sessionId.trim();
			if (!id) {
				return { applied: false };
			}
			const known = activeSessions.has(id);
			await sessionManager.abort(id);
			return { applied: known };
		},
		runProviderAction: async (requestJson) => {
			const manager = new ProviderSettingsManager();
			const parsed = JSON.parse(requestJson) as RpcProviderActionRequest;
			if (isRpcClineAccountActionRequest(parsed)) {
				const settings = manager.getProviderSettings("cline");
				const accountService = new ClineAccountService({
					apiBaseUrl: settings?.baseUrl?.trim() || "https://api.cline.bot",
					getAuthToken: async () => resolveClineAuthToken(settings),
				});
				return {
					resultJson: JSON.stringify(
						await executeRpcClineAccountAction(parsed, accountService),
					),
				};
			}
			if (parsed.action === "listProviders") {
				return { resultJson: JSON.stringify(await listProviders(manager)) };
			}
			if (parsed.action === "getProviderModels") {
				return {
					resultJson: JSON.stringify(
						await getProviderModels(parsed.providerId),
					),
				};
			}
			return {
				resultJson: JSON.stringify(saveProviderSettings(manager, parsed)),
			};
		},
		runProviderOAuthLogin: async (provider) => {
			const providerId = normalizeOAuthProvider(provider);
			const manager = new ProviderSettingsManager();
			const existing = manager.getProviderSettings(providerId);
			const credentials = await loginProvider(providerId, existing);
			const saved = saveProviderOAuthCredentials(
				manager,
				providerId,
				existing,
				credentials,
			);
			const resolvedKey = saved.auth?.accessToken ?? saved.apiKey ?? "";
			return {
				provider: providerId,
				apiKey: resolvedKey,
			};
		},
	};
}
