#!/usr/bin/env bun

import type { ModelInfo } from "../../src/models/schemas/index.js";

type ModelStatus = "active" | "preview" | "deprecated" | "legacy";

interface ModelsDevModel {
	name?: string;
	tool_call?: boolean;
	reasoning?: boolean;
	limit?: {
		context?: number;
		output?: number;
	};
	cost?: {
		input?: number;
		output?: number;
		cache_read?: number;
		cache_write?: number;
	};
	modalities?: {
		input?: string[];
	};
	status?: string;
}

type ModelsDevProviderPayload = {
	models?: Record<string, ModelsDevModel>;
};

type ModelsDevPayload = Record<string, ModelsDevProviderPayload>;

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

const DEFAULT_CONTEXT_WINDOW = 4096;
const DEFAULT_MAX_TOKENS = 4096;

function toStatus(status: string | undefined): ModelStatus | undefined {
	if (
		status === "active" ||
		status === "preview" ||
		status === "deprecated" ||
		status === "legacy"
	) {
		return status;
	}
	return undefined;
}

function toCapabilities(
	model: ModelsDevModel,
): NonNullable<ModelInfo["capabilities"]> {
	const capabilities: NonNullable<ModelInfo["capabilities"]> = [];

	if (model.modalities?.input?.includes("image")) {
		capabilities.push("images");
	}
	if (model.tool_call === true) {
		capabilities.push("tools");
	}
	if (model.reasoning === true) {
		capabilities.push("reasoning");
	}

	return capabilities;
}

function toModelInfo(modelId: string, model: ModelsDevModel): ModelInfo {
	const info: ModelInfo = {
		id: modelId,
		name: model.name || modelId,
		contextWindow: model.limit?.context || DEFAULT_CONTEXT_WINDOW,
		maxTokens: model.limit?.output || DEFAULT_MAX_TOKENS,
		capabilities: toCapabilities(model),
		pricing: {
			input: model.cost?.input ?? 0,
			output: model.cost?.output ?? 0,
			cacheRead: model.cost?.cache_read ?? 0,
			cacheWrite: model.cost?.cache_write ?? 0,
		},
	};

	const status = toStatus(model.status);
	if (status) {
		info.status = status;
	}

	return info;
}

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

async function loadModelsDevPayload(): Promise<ModelsDevPayload> {
	const response = await fetch("https://models.dev/api.json");
	if (!response.ok) {
		throw new Error(`Failed to fetch models.dev: HTTP ${response.status}`);
	}

	return (await response.json()) as ModelsDevPayload;
}

export async function loadModelsDevProviderModels(): Promise<
	Record<string, Record<string, ModelInfo>>
> {
	const payload = await loadModelsDevPayload();
	const providerModels: Record<string, Record<string, ModelInfo>> = {};

	for (const [sourceProviderKey, targetProviderId] of Object.entries(
		PROVIDER_KEY_MAP,
	)) {
		const source = payload[sourceProviderKey];
		if (!source?.models) {
			continue;
		}

		const models: Record<string, ModelInfo> = {};
		for (const [modelId, model] of Object.entries(source.models)) {
			if (model.tool_call !== true) {
				continue;
			}
			models[modelId] = toModelInfo(modelId, model);
		}

		if (Object.keys(models).length > 0) {
			providerModels[targetProviderId] = sortObjectByKey(models, "desc");
		}
	}

	return sortObjectByKey(providerModels);
}
