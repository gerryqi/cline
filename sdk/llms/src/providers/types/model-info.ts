/**
 * Model Information Types
 *
 * Re-exports model types from @cline/models (the single source of truth)
 * and provides provider-specific helpers and aliases.
 */

import type {
	ModelCapability,
	ModelInfo,
	ModelPricing,
	ThinkingConfig,
} from "../../models/schemas/model.js";

export type { ModelCapability, ModelInfo, ModelPricing, ThinkingConfig };

export const ApiFormat = {
	Default: "default",
	OpenAIResponses: "openai-responses",
	R1: "r1",
} as const;
export type ApiFormat = (typeof ApiFormat)[keyof typeof ApiFormat];

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Check if a model has a specific capability
 */
export function hasModelCapability(
	info: ModelInfo,
	capability: ModelCapability,
): boolean {
	return info.capabilities?.includes(capability) ?? false;
}

/**
 * Check if a model supports explicit thinking/reasoning controls.
 */
export function supportsModelThinking(info: ModelInfo): boolean {
	return Boolean(info.thinkingConfig) || hasModelCapability(info, "reasoning");
}

/**
 * Get pricing for a model
 */
export function getModelPricing(info: ModelInfo): ModelPricing {
	return info.pricing ?? {};
}

// =============================================================================
// Model with ID
// =============================================================================

/**
 * Model with its identifier
 */
export interface ModelWithId {
	id: string;
	info: ModelInfo;
}

// =============================================================================
// Type Aliases (for backwards compatibility)
// =============================================================================

/** Alias for ModelInfo - all model types use the same interface */
export type OpenAICompatibleModelInfo = ModelInfo;
