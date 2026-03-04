/**
 * Built-in provider IDs
 *
 * Single source of truth for all built-in provider identifiers.
 * Use BUILT_IN_PROVIDER_IDS for runtime operations (validation, iteration)
 * Use BuiltInProviderId type for compile-time type safety
 */

export enum BUILT_IN_PROVIDER {
	// First-party
	ANTHROPIC = "anthropic",
	CLAUDE_CODE = "claude-code",
	CLINE = "cline",
	// OpenAI variants
	OPENAI = "openai",
	OPENAI_NATIVE = "openai-native",
	OPENAI_CODEX = "openai-codex",
	// Cloud providers
	BEDROCK = "bedrock",
	VERTEX = "vertex",
	GEMINI = "gemini",
	// Local/self-hosted
	OLLAMA = "ollama",
	LMSTUDIO = "lmstudio",
	// OpenAI-compatible
	DEEPSEEK = "deepseek",
	XAI = "xai",
	TOGETHER = "together",
	FIREWORKS = "fireworks",
	GROQ = "groq",
	CEREBRAS = "cerebras",
	SAMBANOVA = "sambanova",
	NEBIUS = "nebius",
	BASETEN = "baseten",
	REQUESTY = "requesty",
	LITELLM = "litellm",
	HUGGINGFACE = "huggingface",
	VERCEL_AI_GATEWAY = "vercel-ai-gateway",
	AIHUBMIX = "aihubmix",
	HICAP = "hicap",
	NOUS_RESEARCH = "nousResearch",
	HUAWEI_CLOUD_MAAS = "huawei-cloud-maas",
	// Regional/specialized
	QWEN = "qwen",
	QWEN_CODE = "qwen-code",
	DOUBAO = "doubao",
	MISTRAL = "mistral",
	MOONSHOT = "moonshot",
	ASKSAGE = "asksage",
	ZAI = "zai",
	MINIMAX = "minimax",
	DIFY = "dify",
	OCA = "oca",
	SAPAICORE = "sapaicore",
	// Aggregators
	OPENROUTER = "openrouter",
}

export const BUILT_IN_PROVIDER_IDS = Object.values(BUILT_IN_PROVIDER) as [
	BUILT_IN_PROVIDER,
	...BUILT_IN_PROVIDER[],
];

/** Type derived from the array - use for type annotations */
export type BuiltInProviderId = (typeof BUILT_IN_PROVIDER_IDS)[number];

/** Check if a string is a valid built-in provider ID */
export function isBuiltInProviderId(id: string): id is BuiltInProviderId {
	return BUILT_IN_PROVIDER_IDS.includes(id as BuiltInProviderId);
}
