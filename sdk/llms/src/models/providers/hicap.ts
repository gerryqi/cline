/**
 * HiCap Provider
 */

import type { ModelCollection } from "../schemas/index.js";

export const HICAP_PROVIDER: ModelCollection = {
	provider: {
		id: "hicap",
		name: "HiCap",
		description: "HiCap AI platform",
		protocol: "openai-chat",
		baseUrl: "https://api.hicap.ai/v1",
		defaultModelId: "hicap-pro",
	},
	models: {},
};
