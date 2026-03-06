/**
 * LM Studio Provider
 */

import { getGeneratedModelsForProvider } from "../generated-access.js";
import type { ModelCollection, ModelInfo } from "../schemas/index.js";

const LMSTUDIO_MODELS: Record<string, ModelInfo> =
	getGeneratedModelsForProvider("lmstudio");

export const LMSTUDIO_PROVIDER: ModelCollection = {
	provider: {
		id: "lmstudio",
		name: "LM Studio",
		description: "Local model inference with LM Studio",
		protocol: "openai-chat",
		baseUrl: "http://localhost:1234/v1",
		defaultModelId: Object.keys(LMSTUDIO_MODELS)[0],
		env: ["LMSTUDIO_API_KEY"],
	},
	models: LMSTUDIO_MODELS || {},
};
