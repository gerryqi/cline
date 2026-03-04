import { GENERATED_PROVIDER_MODELS } from "./generated.js";
import { sortModelsByReleaseDate } from "./models-dev-catalog.js";
import type { ModelInfo } from "./schemas/index.js";

export function getGeneratedProviderModels(): Record<
	string,
	Record<string, ModelInfo>
> {
	return Object.fromEntries(
		Object.entries(GENERATED_PROVIDER_MODELS).map(([providerId, models]) => [
			providerId,
			sortModelsByReleaseDate(models),
		]),
	);
}

export function getGeneratedModelsForProvider(
	providerId: string,
): Record<string, ModelInfo> {
	return sortModelsByReleaseDate(GENERATED_PROVIDER_MODELS[providerId] ?? {});
}
