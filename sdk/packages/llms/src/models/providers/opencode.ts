/**
 * OpenCode Provider
 *
 * OpenCode SDK wrapper provider that supports provider/model IDs
 * like "openai/gpt-5.3-codex" and "anthropic/claude-sonnet-4-5-20250929".
 */

import { getGeneratedModelsForProvider } from "../generated-access.js";
import type { ModelCollection, ModelInfo } from "../schemas/index.js";

export const OPENCODE_MODELS: Record<string, ModelInfo> =
	getGeneratedModelsForProvider("opencode");

export const OPENCODE_DEFAULT_MODEL =
	Object.keys(OPENCODE_MODELS)[0] ?? "openai/gpt-5.3-codex";

export const OPENCODE_PROVIDER: ModelCollection = {
	provider: {
		id: "opencode",
		name: "OpenCode",
		description: "OpenCode SDK multi-provider runtime",
		protocol: "openai-chat",
		baseUrl: "http://127.0.0.1:4096",
		defaultModelId: OPENCODE_DEFAULT_MODEL,
		capabilities: ["reasoning"],
	},
	models: OPENCODE_MODELS,
};
