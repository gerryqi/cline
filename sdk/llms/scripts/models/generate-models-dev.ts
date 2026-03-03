#!/usr/bin/env bun

import {
	fetchModelsDevProviderModels,
	sortModelsByReleaseDate,
} from "../../src/models/models-dev-catalog.js";
import type { ModelInfo } from "../../src/models/schemas/index.js";

// MUST MATCH MODELS_DEV_PROVIDER_KEY_MAP
const PROVIDER_KEY_MAP: Record<string, string> = {
	openai: "openai",
	anthropic: "anthropic",
	google: "gemini",
	deepseek: "deepseek",
	xai: "xai",
	togetherai: "together",
	"fireworks-ai": "fireworks",
	groq: "groq",
	cerebras: "cerebras",
	sambanova: "sambanova",
	nebius: "nebius",
	huggingface: "huggingface",
	vercel: "vercel-ai-gateway",
	openrouter: "openrouter",
	"google-vertex-anthropic": "vertex",
	baseten: "baseten",
	aihubmix: "aihubmix",
	lmstudio: "lmstudio",
	"ollama-cloud": "ollama",
	zai: "zai",
	"amazon-bedrock": "bedrock",
};

function sortObjectByKey<T>(
	input: Record<string, T>,
	order: "asc" | "desc" = "asc",
): Record<string, T> {
	return Object.fromEntries(
		Object.entries(input).sort(([a], [b]) =>
			order === "asc" ? a.localeCompare(b) : b.localeCompare(a),
		),
	);
}

export async function loadModelsDevProviderModels(): Promise<
	Record<string, Record<string, ModelInfo>>
> {
	const providerModels = await fetchModelsDevProviderModels(
		"https://models.dev/api.json",
		PROVIDER_KEY_MAP,
	);
	const releaseDateSortedProviderModels = Object.fromEntries(
		Object.entries(providerModels).map(([providerId, models]) => [
			providerId,
			sortModelsByReleaseDate(models),
		]),
	);
	return sortObjectByKey(releaseDateSortedProviderModels);
}
