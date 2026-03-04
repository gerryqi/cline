/**
 * OpenAI Codex Models
 *
 * Reuses the OpenAI Native catalog so OpenAI Codex and OpenAI Native stay in
 * sync for model availability.
 */

import { getGeneratedModelsForProvider } from "../generated-access.js";
import type { ModelCollection, ModelInfo } from "../schemas/index.js";
import { OPENAI_MODELS } from "./openai.js";

export const OPENAI_CODEX_MODELS: Record<string, ModelInfo> =
	getGeneratedModelsForProvider("openai");

export const OPENAI_CODEX_DEFAULT_MODEL =
	Object.keys(OPENAI_CODEX_MODELS)[0] ?? "gpt-5.3-codex";

export const OPENAI_CODEX_PROVIDER: ModelCollection = {
	provider: {
		id: "openai-codex",
		name: "OpenAI Codex",
		description: "OpenAI Codex via the local Codex CLI provider",
		protocol: "openai-chat",
		// Retained so this provider is included in OPENAI_COMPATIBLE_PROVIDERS
		// registry selection; CodexHandler itself does not use this base URL.
		baseUrl: "https://chatgpt.com/backend-api/codex",
		defaultModelId: OPENAI_CODEX_DEFAULT_MODEL,
		capabilities: ["reasoning"],
	},
	models: OPENAI_MODELS,
};
