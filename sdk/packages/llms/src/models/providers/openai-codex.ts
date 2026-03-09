/**
 * OpenAI Codex Models
 *
 * Reuses the OpenAI Native catalog so OpenAI Codex and OpenAI Native stay in
 * sync for model availability.
 */

import { getGeneratedModelsForProvider } from "../generated-access";
import type { ModelCollection, ModelInfo } from "../schemas/index";
import { OPENAI_MODELS } from "./openai";

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

		baseUrl: "https://chatgpt.com/backend-api/codex",
		defaultModelId: OPENAI_CODEX_DEFAULT_MODEL,
		capabilities: ["reasoning", "oauth"],
	},
	models: OPENAI_MODELS,
};
