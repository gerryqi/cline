/**
 * Provider Configurations
 *
 * Pre-configured settings for all supported OpenAI-compatible providers.
 * Model data is sourced from @cline/models (the single registry).
 */
/** biome-ignore-all lint/style/noNonNullAssertion: static */

import {
	fetchModelsDevProviderModels,
	sortModelsByReleaseDate,
} from "../../models/models-dev-catalog.js";
import * as modelProviderExports from "../../models/providers/index.js";
import type {
	ModelCollection,
	ProviderProtocol,
} from "../../models/schemas/index.js";
import type {
	ModelCatalogConfig,
	ModelInfo,
	ProviderCapability,
} from "../types";

/**
 * Provider defaults for OpenAI-compatible providers
 */
export interface ProviderDefaults {
	/** Base URL for the API */
	baseUrl: string;
	/** Default model ID */
	modelId: string;
	/** Known models with their info */
	knownModels?: Record<string, ModelInfo>;
	/** Capabilities this provider supports */
	capabilities?: ProviderCapability[];
}

export const DEFAULT_MODELS_CATALOG_URL = "https://models.dev/api.json";
const DEFAULT_MODELS_CATALOG_CACHE_TTL_MS = 10 * 60 * 1000;

// Cline's internal provider key: key used in models.dev
const MODELS_DEV_PROVIDER_KEY_MAP: Record<string, string> = {
	openai: "openai-native",
	anthropic: "anthropic",
	google: "gemini",
	deepseek: "deepseek",
	xai: "xai",
	together: "togetherai",
	fireworks: "fireworks-ai",
	groq: "groq",
	cerebras: "cerebras",
	sambanova: "sambanova",
	nebius: "nebius",
	huggingface: "huggingface",
	openrouter: "openrouter",
	ollama: "ollama-cloud",
	"vercel-ai-gateway": "vercel",
	aihubmix: "aihubmix",
	hicap: "hicap",
	"nous-research": "nousResearch",
	"huawei-cloud-maas": "huawei-cloud-maas",
	baseten: "baseten",
	"google-vertex-anthropic": "vertex",
};

const GENERATED_KEYS_BY_PROVIDER: Record<string, string[]> = {
	cline: ["vercel-ai-gateway", "cline"],
	"openai-native": ["openai"],
	nousResearch: ["nousResearch", "nousresearch"],
};

const MODELS_CATALOG_CACHE = new Map<
	string,
	{ expiresAt: number; data: Record<string, Record<string, ModelInfo>> }
>();
const MODELS_CATALOG_IN_FLIGHT = new Map<
	string,
	Promise<Record<string, Record<string, ModelInfo>>>
>();

let generatedModelsLoader:
	| Promise<Record<string, Record<string, ModelInfo>>>
	| undefined;

async function loadGeneratedProviderModels(): Promise<
	Record<string, Record<string, ModelInfo>>
> {
	generatedModelsLoader ??= import("../../models/generated-access.js").then(
		({ getGeneratedProviderModels }) => getGeneratedProviderModels(),
	);
	return generatedModelsLoader;
}

async function mergeKnownModels(
	providerId: string,
	knownModels: Record<string, ModelInfo> = {},
	liveModels: Record<string, ModelInfo> = {},
): Promise<Record<string, ModelInfo>> {
	const generatedProviderModels = await loadGeneratedProviderModels();
	const generatedKeys = GENERATED_KEYS_BY_PROVIDER[providerId] ?? [providerId];
	const generated = Object.assign(
		{},
		...generatedKeys.map(
			(generatedKey) => generatedProviderModels[generatedKey] ?? {},
		),
	);
	return sortModelsByReleaseDate({
		...generated,
		...liveModels,
		...knownModels,
	});
}

async function fetchLiveModelsCatalog(
	url: string,
): Promise<Record<string, Record<string, ModelInfo>>> {
	return fetchModelsDevProviderModels(url, MODELS_DEV_PROVIDER_KEY_MAP);
}

export async function getLiveModelsCatalog(
	options: Pick<ModelCatalogConfig, "url" | "cacheTtlMs"> = {},
): Promise<Record<string, Record<string, ModelInfo>>> {
	const url = options.url ?? DEFAULT_MODELS_CATALOG_URL;
	const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_MODELS_CATALOG_CACHE_TTL_MS;
	const now = Date.now();

	const cached = MODELS_CATALOG_CACHE.get(url);
	if (cached && cached.expiresAt > now) {
		return cached.data;
	}

	const inFlight = MODELS_CATALOG_IN_FLIGHT.get(url);
	if (inFlight) {
		return inFlight;
	}

	const request = fetchLiveModelsCatalog(url)
		.then((data) => {
			MODELS_CATALOG_CACHE.set(url, { data, expiresAt: now + cacheTtlMs });
			return data;
		})
		.finally(() => {
			MODELS_CATALOG_IN_FLIGHT.delete(url);
		});

	MODELS_CATALOG_IN_FLIGHT.set(url, request);
	return request;
}

export function clearLiveModelsCatalogCache(url?: string): void {
	if (url) {
		MODELS_CATALOG_CACHE.delete(url);
		MODELS_CATALOG_IN_FLIGHT.delete(url);
		return;
	}

	MODELS_CATALOG_CACHE.clear();
	MODELS_CATALOG_IN_FLIGHT.clear();
}

function isModelCollection(value: unknown): value is ModelCollection {
	if (!value || typeof value !== "object") {
		return false;
	}

	const maybeCollection = value as Partial<ModelCollection>;
	return (
		typeof maybeCollection.provider === "object" &&
		typeof maybeCollection.models === "object"
	);
}

function isOpenAICompatibleProtocol(
	protocol: ProviderProtocol | undefined,
): boolean {
	return (
		protocol === "openai-chat" ||
		protocol === "openai-responses" ||
		protocol === "openai-r1"
	);
}

function buildOpenAICompatibleProviders(): Record<string, ProviderDefaults> {
	const defaults: Record<string, ProviderDefaults> = {};

	for (const value of Object.values(modelProviderExports)) {
		if (!isModelCollection(value)) {
			continue;
		}

		const provider = value.provider;
		if (!isOpenAICompatibleProtocol(provider.protocol)) {
			continue;
		}
		if (!provider.baseUrl) {
			continue;
		}

		defaults[provider.id] = {
			baseUrl: provider.baseUrl,
			modelId: provider.defaultModelId,
			capabilities: provider.capabilities as ProviderCapability[] | undefined,
		};
	}

	return defaults;
}

/**
 * All OpenAI-compatible provider configurations
 *
 * Model data is sourced from @cline/models to maintain a single source of truth.
 */
export const OPENAI_COMPATIBLE_PROVIDERS: Record<string, ProviderDefaults> =
	buildOpenAICompatibleProviders();

/**
 * Get provider configuration by ID
 */
export function getProviderConfig(
	providerId: string,
): ProviderDefaults | undefined {
	return OPENAI_COMPATIBLE_PROVIDERS[providerId];
}

/**
 * Resolve provider configuration and optionally merge live catalog metadata
 */
export async function resolveProviderConfig(
	providerId: string,
	modelCatalog?: ModelCatalogConfig,
): Promise<ProviderDefaults | undefined> {
	const defaults = getProviderConfig(providerId);
	if (!defaults) {
		return undefined;
	}

	try {
		const liveCatalog = modelCatalog?.loadLatestOnInit
			? await getLiveModelsCatalog(modelCatalog)
			: undefined;
		const liveModels = liveCatalog?.[providerId] ?? {};
		const knownModels = await mergeKnownModels(
			providerId,
			defaults.knownModels,
			liveModels,
		);

		return {
			...defaults,
			knownModels,
		};
	} catch (error) {
		if (modelCatalog?.failOnError) {
			throw error;
		}
		return defaults;
	}
}

/**
 * Check if a provider is OpenAI-compatible
 */
export function isOpenAICompatibleProvider(providerId: string): boolean {
	return providerId in OPENAI_COMPATIBLE_PROVIDERS;
}
