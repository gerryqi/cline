import { GENERATED_PROVIDER_MODELS } from "./generated.js";
import type { ModelInfo } from "./schemas/index.js";

export function getGeneratedProviderModels(): Record<
	string,
	Record<string, ModelInfo>
> {
	return GENERATED_PROVIDER_MODELS;
}

export function getGeneratedModelsForProvider(
	providerId: string,
): Record<string, ModelInfo> {
	return GENERATED_PROVIDER_MODELS[providerId] ?? {};
}
