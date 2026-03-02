/**
 * Requesty Provider
 */

import { getGeneratedModelsForProvider } from "../generated-access.js";
import type { ModelCollection, ModelInfo } from "../schemas/index.js";

export const REQUESTY_MODELS: Record<string, ModelInfo> =
	getGeneratedModelsForProvider("requesty");

export const REQUESTY_PROVIDER: ModelCollection = {
	provider: {
		id: "requesty",
		name: "Requesty",
		description: "AI router with multiple provider support",
		protocol: "openai-chat",
		baseUrl: "https://router.requesty.ai/v1",
		defaultModelId: Object.keys(REQUESTY_MODELS)[0],
		capabilities: ["reasoning"],
		env: ["REQUESTY_API_KEY"],
	},
	models: REQUESTY_MODELS,
};
