import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ProviderSettingsManager } from "@cline/core/server";
import { models } from "@cline/llms";
import type {
	RpcAddProviderActionRequest,
	RpcProviderCapability,
	RpcProviderListItem,
	RpcProviderModel,
	RpcSaveProviderSettingsActionRequest,
} from "@cline/shared";
import type { StoredModelsFile } from "./types";

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
	capabilities: RpcProviderCapability[] | undefined,
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
	capabilities: RpcProviderCapability[] | undefined,
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

export async function ensureCustomProvidersLoaded(
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

export async function addProvider(
	manager: ProviderSettingsManager,
	request: RpcAddProviderActionRequest,
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

export async function listProviders(manager: ProviderSettingsManager): Promise<{
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

export async function getProviderModels(
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

export function saveProviderSettings(
	manager: ProviderSettingsManager,
	request: RpcSaveProviderSettingsActionRequest,
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
