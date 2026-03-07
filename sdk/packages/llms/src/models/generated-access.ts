import { GENERATED_PROVIDER_MODELS } from "./generated.js";
import { sortModelsByReleaseDate } from "./models-dev-catalog.js";
import type { ModelInfo } from "./schemas/index.js";

let sortedGeneratedProviderModelsCache:
	| Record<string, Record<string, ModelInfo>>
	| undefined;
const sortedGeneratedModelsByProviderCache = new Map<
	string,
	Record<string, ModelInfo>
>();

export function getGeneratedProviderModels(): Record<
	string,
	Record<string, ModelInfo>
> {
	sortedGeneratedProviderModelsCache ??= Object.fromEntries(
		Object.entries(GENERATED_PROVIDER_MODELS).map(([providerId, models]) => [
			providerId,
			sortModelsByReleaseDate(models),
		]),
	);
	return sortedGeneratedProviderModelsCache;
}

export function getGeneratedModelsForProvider(
	providerId: string,
): Record<string, ModelInfo> {
	const cached = sortedGeneratedModelsByProviderCache.get(providerId);
	if (cached) {
		return cached;
	}
	const sorted = sortModelsByReleaseDate(
		GENERATED_PROVIDER_MODELS[providerId] ?? {},
	);
	sortedGeneratedModelsByProviderCache.set(providerId, sorted);
	return sorted;
}
