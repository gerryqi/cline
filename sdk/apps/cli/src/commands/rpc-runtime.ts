import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { type AgentEvent, getClineDefaultSystemPrompt } from "@cline/agents";
import {
	ClineAccountService,
	CoreSessionService,
	createOAuthClientCallbacks,
	DefaultSessionManager,
	enrichPromptWithMentions,
	executeRpcClineAccountAction,
	generateWorkspaceInfo,
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
	type RpcClineAccountActionRequest,
	type RpcProviderActionRequest,
	type RpcProviderListItem,
	type RpcProviderModel,
	type RpcProviderSettingsActionRequest,
} from "@cline/shared";
import { setHomeDir, setHomeDirIfUnset } from "@cline/shared/storage";

type OAuthProviderId = "cline" | "oca" | "openai-codex";
type ProviderCapabilityInput =
	| "reasoning"
	| "prompt-cache"
	| "streaming"
	| "tools"
	| "vision";
interface AddProviderRequest {
	action: "addProvider";
	providerId: string;
	name: string;
	baseUrl: string;
	apiKey?: string;
	headers?: Record<string, string>;
	timeoutMs?: number;
	models?: string[];
	defaultModelId?: string;
	modelsSourceUrl?: string;
	capabilities?: ProviderCapabilityInput[];
}
type RpcExtendedProviderActionRequest =
	| RpcProviderActionRequest
	| AddProviderRequest;
type StoredModelsFile = {
	version: 1;
	providers: Record<
		string,
		{
			provider: {
				name: string;
				baseUrl: string;
				defaultModelId: string;
				capabilities?: ProviderCapabilityInput[];
				modelsSourceUrl?: string;
			};
			models: Record<
				string,
				{
					id: string;
					name?: string;
					supportsVision?: boolean;
					supportsAttachments?: boolean;
				}
			>;
		}
	>;
};

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

function resolveModelsRegistryPath(manager: ProviderSettingsManager): string {
	return join(dirname(manager.getFilePath()), "models.json");
}

function emptyModelsFile(): StoredModelsFile {
	return { version: 1, providers: {} };
}

async function readModelsFile(filePath: string): Promise<StoredModelsFile> {
	try {
		const raw = await readFile(filePath, "utf8");
		const parsed = JSON.parse(raw) as Partial<StoredModelsFile>;
		if (
			parsed &&
			parsed.version === 1 &&
			parsed.providers &&
			typeof parsed.providers === "object"
		) {
			return { version: 1, providers: parsed.providers };
		}
	} catch {
		// Invalid or missing files fall back to an empty registry.
	}
	return emptyModelsFile();
}

async function writeModelsFile(
	filePath: string,
	state: StoredModelsFile,
): Promise<void> {
	await mkdir(dirname(filePath), { recursive: true });
	await writeFile(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function toProviderCapabilities(
	capabilities: ProviderCapabilityInput[] | undefined,
): Array<"reasoning" | "prompt-cache" | "tools"> | undefined {
	if (!capabilities || capabilities.length === 0) {
		return undefined;
	}
	const next = new Set<"reasoning" | "prompt-cache" | "tools">();
	if (capabilities.includes("reasoning")) {
		next.add("reasoning");
	}
	if (capabilities.includes("prompt-cache")) {
		next.add("prompt-cache");
	}
	if (capabilities.includes("tools")) {
		next.add("tools");
	}
	return next.size > 0 ? [...next] : undefined;
}

function toModelCapabilities(
	capabilities: ProviderCapabilityInput[] | undefined,
): Array<
	"streaming" | "tools" | "reasoning" | "prompt-cache" | "images" | "files"
> {
	const next = new Set<
		"streaming" | "tools" | "reasoning" | "prompt-cache" | "images" | "files"
	>();
	if (!capabilities || capabilities.length === 0) {
		return [...next];
	}
	if (capabilities.includes("streaming")) {
		next.add("streaming");
	}
	if (capabilities.includes("tools")) {
		next.add("tools");
	}
	if (capabilities.includes("reasoning")) {
		next.add("reasoning");
	}
	if (capabilities.includes("prompt-cache")) {
		next.add("prompt-cache");
	}
	if (capabilities.includes("vision")) {
		next.add("images");
		next.add("files");
	}
	return [...next];
}

function registerCustomProvider(
	providerId: string,
	entry: StoredModelsFile["providers"][string],
): void {
	const modelCapabilities = toModelCapabilities(entry.provider.capabilities);
	const modelEntries = Object.values(entry.models)
		.map((model) => model.id.trim())
		.filter((modelId) => modelId.length > 0);
	const defaultModelId =
		entry.provider.defaultModelId?.trim() || modelEntries[0] || "default";
	const normalizedModels = Object.fromEntries(
		modelEntries.map((modelId) => [
			modelId,
			{
				id: modelId,
				name: entry.models[modelId]?.name ?? modelId,
				capabilities:
					modelCapabilities.length > 0 ? modelCapabilities : undefined,
				status: "active" as const,
			},
		]),
	);

	models.registerProvider({
		provider: {
			id: providerId,
			name: entry.provider.name.trim() || titleCaseFromId(providerId),
			protocol: "openai-chat",
			baseUrl: entry.provider.baseUrl,
			defaultModelId,
			capabilities: toProviderCapabilities(entry.provider.capabilities),
		},
		models: normalizedModels,
	});
}

let customProvidersLoaded = false;

async function ensureCustomProvidersLoaded(
	manager: ProviderSettingsManager,
): Promise<void> {
	if (customProvidersLoaded) {
		return;
	}
	const modelsPath = resolveModelsRegistryPath(manager);
	const state = await readModelsFile(modelsPath);
	for (const [providerId, entry] of Object.entries(state.providers)) {
		registerCustomProvider(providerId, entry);
	}
	customProvidersLoaded = true;
}

function parseModelIdList(input: unknown): string[] {
	if (Array.isArray(input)) {
		return input
			.map((item) => {
				if (typeof item === "string") {
					return item.trim();
				}
				if (item && typeof item === "object" && "id" in item) {
					const id = (item as { id?: unknown }).id;
					return typeof id === "string" ? id.trim() : "";
				}
				return "";
			})
			.filter((id) => id.length > 0);
	}
	return [];
}

function extractModelIdsFromPayload(
	payload: unknown,
	providerId: string,
): string[] {
	const rootArray = parseModelIdList(payload);
	if (rootArray.length > 0) {
		return rootArray;
	}
	if (!payload || typeof payload !== "object") {
		return [];
	}
	const data = payload as {
		data?: unknown;
		models?: unknown;
		providers?: Record<string, unknown>;
	};
	const direct = parseModelIdList(data.data ?? data.models);
	if (direct.length > 0) {
		return direct;
	}
	if (
		data.models &&
		typeof data.models === "object" &&
		!Array.isArray(data.models)
	) {
		const modelKeys = Object.keys(data.models).filter(
			(key) => key.trim().length > 0,
		);
		if (modelKeys.length > 0) {
			return modelKeys;
		}
	}
	const providerScoped = data.providers?.[providerId];
	if (providerScoped && typeof providerScoped === "object") {
		const nested = providerScoped as { models?: unknown };
		const nestedList = parseModelIdList(nested.models ?? providerScoped);
		if (nestedList.length > 0) {
			return nestedList;
		}
	}
	return [];
}

async function fetchModelIdsFromSource(
	url: string,
	providerId: string,
): Promise<string[]> {
	const response = await fetch(url, { method: "GET" });
	if (!response.ok) {
		throw new Error(
			`failed to fetch models from ${url}: HTTP ${response.status}`,
		);
	}
	const payload = (await response.json()) as unknown;
	return extractModelIdsFromPayload(payload, providerId);
}

async function addProvider(
	manager: ProviderSettingsManager,
	request: AddProviderRequest,
): Promise<{
	providerId: string;
	settingsPath: string;
	modelsPath: string;
	modelsCount: number;
}> {
	const providerId = request.providerId.trim().toLowerCase();
	if (!providerId) {
		throw new Error("providerId is required");
	}
	if (models.hasProvider(providerId)) {
		throw new Error(`provider "${providerId}" already exists`);
	}
	const providerName = request.name.trim();
	if (!providerName) {
		throw new Error("name is required");
	}
	const baseUrl = request.baseUrl.trim();
	if (!baseUrl) {
		throw new Error("baseUrl is required");
	}

	const typedModels = (request.models ?? [])
		.map((model) => model.trim())
		.filter((model) => model.length > 0);
	const sourceUrl = request.modelsSourceUrl?.trim();
	const fetchedModels = sourceUrl
		? await fetchModelIdsFromSource(sourceUrl, providerId)
		: [];
	const modelIds = [...new Set([...typedModels, ...fetchedModels])];
	if (modelIds.length === 0) {
		throw new Error(
			"at least one model is required (manual or via modelsSourceUrl)",
		);
	}

	const defaultModelId =
		request.defaultModelId?.trim() &&
		modelIds.includes(request.defaultModelId.trim())
			? request.defaultModelId.trim()
			: modelIds[0];
	const capabilities = request.capabilities?.length
		? [...new Set(request.capabilities)]
		: undefined;
	const headerEntries = Object.entries(request.headers ?? {}).filter(
		([key]) => key.trim().length > 0,
	);

	manager.saveProviderSettings(
		{
			provider: providerId,
			apiKey: request.apiKey?.trim() ? request.apiKey : undefined,
			baseUrl,
			headers:
				headerEntries.length > 0
					? Object.fromEntries(headerEntries)
					: undefined,
			timeout: request.timeoutMs,
			model: defaultModelId,
		},
		{ setLastUsed: false },
	);

	const modelsPath = resolveModelsRegistryPath(manager);
	const modelsState = await readModelsFile(modelsPath);
	const supportsVision = capabilities?.includes("vision") ?? false;
	const supportsAttachments = supportsVision;
	modelsState.providers[providerId] = {
		provider: {
			name: providerName,
			baseUrl,
			defaultModelId,
			capabilities,
			modelsSourceUrl: sourceUrl,
		},
		models: Object.fromEntries(
			modelIds.map((modelId) => [
				modelId,
				{
					id: modelId,
					name: modelId,
					supportsVision,
					supportsAttachments,
				},
			]),
		),
	};
	await writeModelsFile(modelsPath, modelsState);
	registerCustomProvider(providerId, modelsState.providers[providerId]);

	return {
		providerId,
		settingsPath: manager.getFilePath(),
		modelsPath,
		modelsCount: modelIds.length,
	};
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
		stopSession: async (sessionId) => {
			const id = sessionId.trim();
			if (!id) {
				return { applied: false };
			}
			const known = activeSessions.has(id);
			await sessionManager.stop(id);
			activeSessions.delete(id);
			sessionModes.delete(id);
			return { applied: known };
		},
		runProviderAction: async (requestJson) => {
			const manager = new ProviderSettingsManager();
			await ensureCustomProvidersLoaded(manager);
			const parsed = JSON.parse(
				requestJson,
			) as RpcExtendedProviderActionRequest;
			if (parsed.action === "clineAccount") {
				const settings = manager.getProviderSettings("cline");
				const accountService = new ClineAccountService({
					apiBaseUrl: settings?.baseUrl?.trim() || "https://api.cline.bot",
					getAuthToken: async () => resolveClineAuthToken(settings),
				});
				return {
					resultJson: JSON.stringify(
						await executeRpcClineAccountAction(
							parsed as RpcClineAccountActionRequest,
							accountService,
						),
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
			if (parsed.action === "addProvider") {
				return {
					resultJson: JSON.stringify(await addProvider(manager, parsed)),
				};
			}
			if (parsed.action === "saveProviderSettings") {
				return {
					resultJson: JSON.stringify(saveProviderSettings(manager, parsed)),
				};
			}
			throw new Error(`unsupported provider action: ${String(parsed)}`);
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
		dispose: async () => {
			await sessionManager.dispose("rpc_runtime_shutdown");
			activeSessions.clear();
			sessionModes.clear();
			eventClient.close();
		},
	};
}
