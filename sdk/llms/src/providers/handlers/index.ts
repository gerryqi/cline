/**
 * Handlers Index
 *
 * Re-exports all handler classes and factory functions.
 */

export { AnthropicHandler, createAnthropicHandler } from "./anthropic-base";
export {
	getMissingApiKeyError,
	getProviderEnvKeys,
	normalizeProviderId,
	resolveApiKeyForProvider,
} from "./auth";
// Base classes
export { BaseHandler, DEFAULT_MODEL_INFO } from "./base";
export { BedrockHandler, createBedrockHandler } from "./bedrock-base";
export { createGeminiHandler, GeminiHandler } from "./gemini-base";
// OpenAI Chat Completions API handler
export { createOpenAIHandler, OpenAIBaseHandler } from "./openai-base";
// OpenAI Responses API handler
export {
	createOpenAIResponsesHandler,
	OpenAIResponsesHandler,
} from "./openai-responses";
// Provider configurations
export {
	clearLiveModelsCatalogCache,
	DEFAULT_MODELS_CATALOG_URL,
	getLiveModelsCatalog,
	getProviderConfig,
	isOpenAICompatibleProvider,
	OPENAI_COMPATIBLE_PROVIDERS,
	type ProviderDefaults,
	resolveProviderConfig,
} from "./providers";
// R1-based handlers (DeepSeek Reasoner, etc.)
export { createR1Handler, R1BaseHandler } from "./r1-base";
// Custom handler registry
export {
	clearRegistry,
	getRegisteredHandler,
	getRegisteredHandlerAsync,
	getRegisteredProviderIds,
	hasRegisteredHandler,
	isRegisteredHandlerAsync,
	registerAsyncHandler,
	registerHandler,
	unregisterHandler,
} from "./registry";
export { createVertexHandler, VertexHandler } from "./vertex";
