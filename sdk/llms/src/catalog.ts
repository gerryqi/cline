import * as modelProviderExports from "./models/providers/index.js";
import type {
	ModelCollection,
	ModelInfo,
	ProviderCapability,
	ProviderProtocol,
} from "./models/schemas/index.js";

export * as models from "./models/index.js";
export type { ProviderCapability } from "./models/schemas/index.js";

export interface OpenAICompatibleProviderDefaults {
	baseUrl: string;
	modelId: string;
	knownModels: Record<string, ModelInfo>;
	capabilities?: ProviderCapability[];
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

function buildOpenAICompatibleProviders(): Record<
	string,
	OpenAICompatibleProviderDefaults
> {
	const defaults: Record<string, OpenAICompatibleProviderDefaults> = {};

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
			knownModels: value.models,
			capabilities: provider.capabilities as ProviderCapability[] | undefined,
		};
	}

	return defaults;
}

export const OPENAI_COMPATIBLE_PROVIDERS = buildOpenAICompatibleProviders();
