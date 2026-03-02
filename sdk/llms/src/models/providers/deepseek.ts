/**
 * DeepSeek Models
 */

import { getGeneratedModelsForProvider } from "../generated-access.js";
import type { ModelCollection, ModelInfo } from "../schemas/index.js";

export const DEEPSEEK_MODELS: Record<string, ModelInfo> =
	getGeneratedModelsForProvider("deepseek");

export const DEEPSEEK_DEFAULT_MODEL = Object.keys(DEEPSEEK_MODELS)[0];

export const DEEPSEEK_PROVIDER: ModelCollection = {
	provider: {
		id: "deepseek",
		name: "DeepSeek",
		description: "Advanced AI models with reasoning capabilities",
		protocol: "openai-chat",
		baseUrl: "https://api.deepseek.com/v1",
		defaultModelId: DEEPSEEK_DEFAULT_MODEL,
		capabilities: ["reasoning", "prompt-cache"],
	},
	models: DEEPSEEK_MODELS,
};

export function getDeepSeekReasoningModels(): Record<string, ModelInfo> {
	return Object.fromEntries(
		Object.entries(DEEPSEEK_MODELS).filter(([, info]) =>
			info.capabilities?.includes("reasoning"),
		),
	);
}
