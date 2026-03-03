/**
 * @cline/providers
 *
 * SDK-like package for creating and managing LLM provider handlers.
 *
 * This package provides a unified interface for interacting with various LLM providers.
 * It standardizes configuration, message formats, and streaming responses.
 *
 * ## Quick Start
 *
 * ```typescript
 * import { createHandler, type ProviderConfig } from "@cline/providers"
 *
 * const config: ProviderConfig = {
 *   providerId: "anthropic",
 *   apiKey: process.env.ANTHROPIC_API_KEY,
 *   modelId: "claude-sonnet-4-20250514",
 * }
 *
 * const handler = createHandler(config)
 * const stream = handler.createMessage("You are a helpful assistant.", messages)
 *
 * for await (const chunk of stream) {
 *   if (chunk.type === "text") {
 *     process.stdout.write(chunk.text)
 *   }
 * }
 * ```
 *
 * ## Supported Providers
 *
 * - **anthropic**: Anthropic's Claude models
 * - **gemini**: Google's Gemini models (including Vertex AI)
 * - **openai**: OpenAI's GPT models
 * - **openai-compat**: Any OpenAI-compatible API (DeepSeek, xAI, Together, etc.)
 *
 * @module
 */

// =============================================================================
// Types
// =============================================================================

export {
	ApiFormat,
	// Handler types
	type ApiHandler,
	// Stream types
	type ApiStream,
	type ApiStreamChunk,
	type ApiStreamReasoningChunk,
	type ApiStreamTextChunk,
	type ApiStreamToolCall,
	type ApiStreamToolCallsChunk,
	type ApiStreamUsageChunk,
	type AuthConfig,
	type AuthSettings,
	AuthSettingsSchema,
	type AwsConfig,
	type AwsSettings,
	AwsSettingsSchema,
	type AzureConfig,
	type AzureSettings,
	AzureSettingsSchema,
	type BuiltInProviderId,
	type CloudConfig,
	type ContentBlock,
	createConfig,
	createProviderConfig,
	type EndpointConfig,
	type GcpConfig,
	type GcpSettings,
	GcpSettingsSchema,
	getModelPricing,
	type HandlerFactory,
	type HandlerModelInfo,
	hasCapability,
	hasModelCapability,
	type ImageContent,
	type LazyHandlerFactory,
	// Message types
	type Message,
	type MessageRole,
	type MessageWithMetadata,
	type ModelCapability,
	type ModelCatalogConfig,
	type ModelCatalogSettings,
	ModelCatalogSettingsSchema,
	type ModelConfig,
	// Model types
	type ModelInfo,
	type ModelPricing,
	type ModelWithId,
	type OcaConfig,
	type OcaSettings,
	OcaSettingsSchema,
	type OpenAICompatibleModelInfo,
	type ProviderCapability,
	type ProviderCategory,
	type ProviderConfig,
	type ProviderDefaultsConfig,
	// Config types
	type ProviderId,
	// Settings types and functions (Zod-based validation)
	ProviderIdSchema,
	type ProviderOptions,
	type ProviderSettings,
	ProviderSettingsSchema,
	type ProviderSpecificConfig,
	parseSettings,
	type ReasoningConfig,
	type ReasoningSettings,
	ReasoningSettingsSchema,
	type RedactedThinkingContent,
	type RegionConfig,
	type SapConfig,
	type SapSettings,
	SapSettingsSchema,
	type SimpleProviderConfig,
	type SingleCompletionHandler,
	safeCreateProviderConfig,
	safeParseSettings,
	supportsPromptCache,
	supportsReasoning,
	type TextContent,
	type ThinkingConfig,
	type ThinkingContent,
	type TokenConfig,
	type ToolDefinition,
	type ToolResultContent,
	type ToolUseContent,
	toProviderConfig,
} from "./types";

// =============================================================================
// Handlers
// =============================================================================

export {
	// Provider-specific handlers
	AnthropicHandler,
	// Base classes (for extension)
	BaseHandler,
	clearLiveModelsCatalogCache,
	// Custom handler registry
	clearRegistry,
	createAnthropicHandler,
	createGeminiHandler,
	createOpenAIHandler,
	createOpenAIResponsesHandler,
	createR1Handler,
	createVertexHandler,
	DEFAULT_MODEL_INFO,
	DEFAULT_MODELS_CATALOG_URL,
	GeminiHandler,
	getLiveModelsCatalog,
	getMissingApiKeyError,
	getProviderConfig,
	getRegisteredHandler,
	getRegisteredHandlerAsync,
	getRegisteredProviderIds,
	hasRegisteredHandler,
	isOpenAICompatibleProvider,
	isRegisteredHandlerAsync,
	normalizeProviderId,
	// Provider configs
	OPENAI_COMPATIBLE_PROVIDERS,
	// OpenAI Chat Completions API handler
	OpenAIBaseHandler,
	// OpenAI Responses API handler
	OpenAIResponsesHandler,
	// R1-based handlers (DeepSeek Reasoner, etc.)
	R1BaseHandler,
	registerAsyncHandler,
	registerHandler,
	resolveProviderConfig,
	unregisterHandler,
	// Vertex AI handler
	VertexHandler,
} from "./handlers";

// =============================================================================
// Transform utilities
// =============================================================================

export {
	convertToAnthropicMessages,
	convertToGeminiMessages,
	convertToOpenAIMessages,
	convertToolsToAnthropic,
	convertToolsToGemini,
	convertToolsToOpenAI,
	// R1 format (DeepSeek Reasoner, etc.)
	convertToR1Messages,
	getOpenAIToolParams,
	type R1Message,
} from "./transform";

// =============================================================================
// Utilities
// =============================================================================

export {
	type AssistantContentBlock,
	type AssistantRedactedThinkingBlock,
	type AssistantTextBlock,
	type AssistantThinkingBlock,
	type AssistantToolUseBlock,
	calculateRetryDelay,
	isRetriableError,
	type ProcessedResponse,
	type ReasoningDetailParam,
	RetriableError,
	type RetryOptions,
	retryAsync,
	// Stream processor
	StreamResponseProcessor,
	sleep,
	ToolCallProcessor,
	type UsageInfo,
	withRetry,
} from "./utils";

import { CLINE_PROVIDER } from "../models";
// =============================================================================
// Main Factory Function
// =============================================================================

import { AnthropicHandler } from "./handlers/anthropic-base";
import { normalizeProviderId } from "./handlers/auth";
import { BedrockHandler } from "./handlers/bedrock-base";
import { GeminiHandler } from "./handlers/gemini-base";
import { OpenAIBaseHandler } from "./handlers/openai-base";
import { OpenAIResponsesHandler } from "./handlers/openai-responses";
import {
	isOpenAICompatibleProvider,
	OPENAI_COMPATIBLE_PROVIDERS,
	resolveProviderConfig,
} from "./handlers/providers";
import {
	getRegisteredHandler,
	getRegisteredHandlerAsync,
	hasRegisteredHandler,
	isRegisteredHandlerAsync,
} from "./handlers/registry";
import { VertexHandler } from "./handlers/vertex";
import type { ApiHandler, ProviderConfig, ProviderId } from "./types";

const ANTHROPIC_PROVIDER_ID = "anthropic";
const BEDROCK_PROVIDER_ID = "bedrock";
const GEMINI_PROVIDER_ID = "gemini";
const OPENAI_PROVIDER_ID = "openai-native";
const VERTEX_PROVIDER_ID = "vertex";

function withNormalizedProviderId(config: ProviderConfig): ProviderConfig {
	const normalizedProviderId = normalizeProviderId(config.providerId);
	if (normalizedProviderId === config.providerId) {
		return config;
	}
	return {
		...config,
		providerId: normalizedProviderId,
	};
}

/**
 * Create an API handler for the specified provider
 *
 * This is the main entry point for creating handlers. It automatically
 * selects the appropriate handler class based on the provider ID.
 *
 * Custom handlers registered via `registerHandler()` take precedence over
 * built-in handlers.
 *
 * @param config - Provider configuration
 * @returns An API handler instance
 * @throws Error if the provider has an async handler - use `createHandlerAsync()` instead
 *
 * @example
 * ```typescript
 * const handler = createHandler({
 *   providerId: "anthropic",
 *   apiKey: "sk-...",
 *   modelId: "claude-sonnet-4-20250514",
 * })
 * ```
 */
export function createHandler(config: ProviderConfig): ApiHandler {
	const normalizedConfig = withNormalizedProviderId(config);
	const { providerId } = normalizedConfig;

	// Check custom registry first (allows overriding built-in handlers)
	if (hasRegisteredHandler(providerId)) {
		if (isRegisteredHandlerAsync(providerId)) {
			throw new Error(
				`Handler for "${providerId}" is registered as async. Use createHandlerAsync() instead.`,
			);
		}
		const handler = getRegisteredHandler(providerId, normalizedConfig);
		if (handler) {
			return handler;
		}
	}

	switch (providerId) {
		case ANTHROPIC_PROVIDER_ID:
			return new AnthropicHandler(normalizedConfig);

		case BEDROCK_PROVIDER_ID:
			return new BedrockHandler(normalizedConfig);

		case GEMINI_PROVIDER_ID:
			return new GeminiHandler(normalizedConfig);

		case VERTEX_PROVIDER_ID:
			return new VertexHandler(normalizedConfig);

		case OPENAI_PROVIDER_ID:
			return new OpenAIResponsesHandler(normalizedConfig);

		default:
			// Check if it's an OpenAI-compatible provider
			if (isOpenAICompatibleProvider(providerId)) {
				if (normalizedConfig.modelCatalog?.loadLatestOnInit) {
					throw new Error(
						`Provider "${providerId}" has modelCatalog.loadLatestOnInit enabled. Use createHandlerAsync() to allow runtime model refresh.`,
					);
				}
				const providerDefaults = OPENAI_COMPATIBLE_PROVIDERS[providerId];
				// Merge provider defaults into config
				return new OpenAIBaseHandler({
					...normalizedConfig,
					baseUrl: normalizedConfig.baseUrl ?? providerDefaults.baseUrl,
					modelId: normalizedConfig.modelId ?? providerDefaults.modelId,
					knownModels:
						normalizedConfig.knownModels ?? providerDefaults.knownModels,
					capabilities:
						normalizedConfig.capabilities ?? providerDefaults.capabilities,
				});
			}

			// Fall back to OpenAI-compatible with custom base URL
			return normalizedConfig.baseUrl
				? new OpenAIBaseHandler(normalizedConfig)
				: new OpenAIResponsesHandler({
						...normalizedConfig,
						baseUrl: "https://api.openai.com/v1",
					});
	}
}

/**
 * Create an API handler asynchronously
 *
 * Use this when you have handlers registered with `registerAsyncHandler()`.
 * This function works with both sync and async registered handlers.
 *
 * @param config - Provider configuration
 * @returns Promise resolving to an API handler instance
 *
 * @example
 * ```typescript
 * // Register an async handler for lazy loading
 * registerAsyncHandler("my-provider", async (config) => {
 *   const { MyHandler } = await import("./my-handler")
 *   return new MyHandler(config)
 * })
 *
 * // Use createHandlerAsync to get the handler
 * const handler = await createHandlerAsync({
 *   providerId: "my-provider",
 *   modelId: "my-model",
 * })
 * ```
 */
export async function createHandlerAsync(
	config: ProviderConfig,
): Promise<ApiHandler> {
	const normalizedConfig = withNormalizedProviderId(config);
	const { providerId } = normalizedConfig;

	// Check custom registry first (allows overriding built-in handlers)
	if (hasRegisteredHandler(providerId)) {
		const handler = await getRegisteredHandlerAsync(
			providerId,
			normalizedConfig,
		);
		if (handler) {
			return handler;
		}
	}

	if (isOpenAICompatibleProvider(providerId)) {
		const providerDefaults = await resolveProviderConfig(
			providerId,
			normalizedConfig.modelCatalog,
		);
		if (providerDefaults) {
			return new OpenAIBaseHandler({
				...normalizedConfig,
				baseUrl: normalizedConfig.baseUrl ?? providerDefaults.baseUrl,
				modelId: normalizedConfig.modelId ?? providerDefaults.modelId,
				knownModels:
					normalizedConfig.knownModels ?? providerDefaults.knownModels,
				capabilities:
					normalizedConfig.capabilities ?? providerDefaults.capabilities,
			});
		}
	}

	if (providerId === BEDROCK_PROVIDER_ID) {
		return new BedrockHandler(normalizedConfig);
	}

	// Fall back to sync handler creation for built-in providers
	return createHandler(normalizedConfig);
}

/**
 * List of all built-in provider IDs
 */
export const BUILT_IN_PROVIDERS: ProviderId[] = [
	CLINE_PROVIDER.provider.id,
	ANTHROPIC_PROVIDER_ID,
	BEDROCK_PROVIDER_ID,
	OPENAI_PROVIDER_ID,
	GEMINI_PROVIDER_ID,
	VERTEX_PROVIDER_ID,
	...Object.keys(OPENAI_COMPATIBLE_PROVIDERS),
] as ProviderId[];

/**
 * Check if a provider ID is supported (built-in or registered)
 */
export function isProviderSupported(providerId: string): boolean {
	return (
		providerId === ANTHROPIC_PROVIDER_ID ||
		providerId === BEDROCK_PROVIDER_ID ||
		providerId === GEMINI_PROVIDER_ID ||
		providerId === VERTEX_PROVIDER_ID ||
		isOpenAICompatibleProvider(providerId) ||
		hasRegisteredHandler(providerId)
	);
}
