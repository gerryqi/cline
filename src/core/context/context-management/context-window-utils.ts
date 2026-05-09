import { ApiHandler } from "@core/api"
import { DeepSeekHandler } from "@core/api/providers/deepseek"
import { OpenAiHandler } from "@core/api/providers/openai"

/**
 * Gets context window information for the given API handler
 *
 * @param api The API handler to get context window information for
 * @returns An object containing the raw context window size and the effective max allowed size
 */
export function getContextWindowInfo(api: ApiHandler) {
	let contextWindow = api.getModel().info.contextWindow || 128_000

	// Handle OpenAI-compatible handlers (OpenAiHandler, DeepSeekHandler, etc.)
	// with deepseek models — use actual model info when available to avoid
	// forcing 128K on models with different context windows (e.g., v4-pro 1M).
	if (
		(api instanceof OpenAiHandler || api instanceof DeepSeekHandler) &&
		api.getModel().id.toLowerCase().includes("deepseek")
	) {
		contextWindow = api.getModel().info.contextWindow || 128_000
	}

	const maxTokens = api.getModel().info.maxTokens || 0

	let maxAllowedSize: number
	// Dynamic buffer sizing based on context window tiers.
	// Smaller context windows need proportionally larger buffers for output tokens;
	// larger windows dynamically adjust based on the model's maxTokens to ensure
	// enough room for long outputs (e.g., DeepSeek V4 Pro with 384K maxTokens).
	if (contextWindow <= 64_000) {
		// deepseek-v4-flash and similar small models: reserve ~42% for output
		maxAllowedSize = contextWindow - 27_000
	} else if (contextWindow <= 128_000) {
		// deepseek-chat, deepseek-reasoner, and most 128K models: reserve ~23%
		maxAllowedSize = contextWindow - 30_000
	} else if (contextWindow <= 200_000) {
		// Claude models: reserve 20%
		maxAllowedSize = contextWindow - 40_000
	} else if (contextWindow <= 500_000) {
		// Mid-large windows: reserve 100K (conservative)
		maxAllowedSize = contextWindow - 100_000
	} else {
		// Extra-large windows (deepseek-v4-pro 1M, etc.):
		// Use a model-aware buffer based on maxTokens rather than a fixed value.
		// This prevents context_length_exceeded errors when models like DeepSeek V4
		// (maxTokens=384K) generate very long outputs.
		//
		// Buffer strategy: reserve at most 40% of context window for output,
		// using 35% of maxTokens as the model-based estimate (reduced from 50%
		// for better utilization of oversized context windows).
		// Minimum buffer of 45K ensures safety without over-reserving.
		const modelBasedBuffer = Math.min(maxTokens * 0.35, contextWindow * 0.4)
		const buffer = Math.max(modelBasedBuffer, 45_000)
		maxAllowedSize = Math.max(contextWindow - buffer, contextWindow * 0.5)
	}

	return { contextWindow, maxAllowedSize }
}
