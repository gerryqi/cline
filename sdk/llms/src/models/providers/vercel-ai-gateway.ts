/**
 * Vercel AI Gateway Provider
 */

import { getGeneratedModelsForProvider } from "../generated-access.js";
import type { ModelCollection } from "../schemas/index.js";

const VERCEL_AI_GATEWAY_MODELS =
	getGeneratedModelsForProvider("vercel-ai-gateway");

export const VERCEL_AI_GATEWAY_PROVIDER: ModelCollection = {
	provider: {
		id: "vercel-ai-gateway",
		name: "Vercel AI Gateway",
		description: "Vercel's AI gateway service",
		protocol: "openai-chat",
		baseUrl: "https://ai-gateway.vercel.app/v1",
		defaultModelId: Object.keys(VERCEL_AI_GATEWAY_MODELS)[0],
		capabilities: ["reasoning"],
	},
	models: getGeneratedModelsForProvider("vercel-ai-gateway"),
};
