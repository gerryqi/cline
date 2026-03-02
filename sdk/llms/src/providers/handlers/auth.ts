import { AIHUBMIX_PROVIDER } from "../../models/providers/aihubmix.js";
import { ANTHROPIC_PROVIDER } from "../../models/providers/anthropic.js";
import { BEDROCK_PROVIDER } from "../../models/providers/bedrock.js";
import { HUGGINGFACE_PROVIDER } from "../../models/providers/huggingface.js";
import { LMSTUDIO_PROVIDER } from "../../models/providers/lmstudio.js";
import { OLLAMA_PROVIDER } from "../../models/providers/ollama.js";
import { OPENAI_PROVIDER } from "../../models/providers/openai.js";
import { OPENROUTER_PROVIDER } from "../../models/providers/openrouter.js";
import { REQUESTY_PROVIDER } from "../../models/providers/requesty.js";
import { ZAI_PROVIDER } from "../../models/providers/zai.js";

const PROVIDER_ID_ALIASES: Record<string, string> = {
	openai: "openai-native",
};

const ENV_KEYS_BY_PROVIDER: Record<string, readonly string[]> = {
	[ANTHROPIC_PROVIDER.provider.id]: ANTHROPIC_PROVIDER.provider.env ?? [],
	[BEDROCK_PROVIDER.provider.id]: BEDROCK_PROVIDER.provider.env ?? [],
	[OPENAI_PROVIDER.provider.id]: OPENAI_PROVIDER.provider.env ?? [],
	openai: OPENAI_PROVIDER.provider.env ?? [],
	[OPENROUTER_PROVIDER.provider.id]: OPENROUTER_PROVIDER.provider.env ?? [],
	[REQUESTY_PROVIDER.provider.id]: REQUESTY_PROVIDER.provider.env ?? [],
	[OLLAMA_PROVIDER.provider.id]: OLLAMA_PROVIDER.provider.env ?? [],
	[LMSTUDIO_PROVIDER.provider.id]: LMSTUDIO_PROVIDER.provider.env ?? [],
	[AIHUBMIX_PROVIDER.provider.id]: AIHUBMIX_PROVIDER.provider.env ?? [],
	[HUGGINGFACE_PROVIDER.provider.id]: HUGGINGFACE_PROVIDER.provider.env ?? [],
	[ZAI_PROVIDER.provider.id]: ZAI_PROVIDER.provider.env ?? [],
	// OpenAI-compatible providers covered in the legacy provider list.
	deepseek: ["DEEPSEEK_API_KEY"],
	together: ["TOGETHER_API_KEY", "TOGETHERAI_API_KEY"],
	fireworks: ["FIREWORKS_API_KEY"],
	groq: ["GROQ_API_KEY"],
	xai: ["XAI_API_KEY"],
	cerebras: ["CEREBRAS_API_KEY"],
	sambanova: ["SAMBANOVA_API_KEY"],
	nebius: ["NEBIUS_API_KEY"],
	baseten: ["BASETEN_API_KEY"],
	litellm: ["LITELLM_API_KEY"],
	"vercel-ai-gateway": ["VERCEL_AI_GATEWAY_API_KEY"],
	"huawei-cloud-maas": ["HUAWEI_CLOUD_MAAS_API_KEY"],
	hicap: ["HICAP_API_KEY"],
	nousResearch: ["NOUS_RESEARCH_API_KEY", "NOUSRESEARCH_API_KEY"],
	gemini: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
	vertex: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
	cline: ["CLINE_API_KEY"],
};

const DEFAULT_FALLBACK_ENV_KEYS = [
	"CLINE_API_KEY",
	...(ANTHROPIC_PROVIDER.provider.env ?? []),
	...(OPENAI_PROVIDER.provider.env ?? []),
];

function readTrimmed(
	env: Record<string, string | undefined>,
	key: string,
): string | undefined {
	const value = env[key];
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function resolveFromKeys(
	keys: readonly string[],
	env: Record<string, string | undefined>,
): string | undefined {
	for (const key of keys) {
		const value = readTrimmed(env, key);
		if (value) {
			return value;
		}
	}
	return undefined;
}

export function normalizeProviderId(providerId: string): string {
	const normalized = providerId.trim();
	return PROVIDER_ID_ALIASES[normalized] ?? normalized;
}

export function getProviderEnvKeys(providerId: string): readonly string[] {
	return ENV_KEYS_BY_PROVIDER[normalizeProviderId(providerId)] ?? [];
}

export function resolveApiKeyForProvider(
	providerId: string,
	explicitApiKey: string | undefined,
	env: Record<string, string | undefined> = process.env,
): string | undefined {
	const explicit = explicitApiKey?.trim();
	if (explicit) {
		return explicit;
	}

	const providerKey = resolveFromKeys(getProviderEnvKeys(providerId), env);
	if (providerKey) {
		return providerKey;
	}

	return resolveFromKeys(DEFAULT_FALLBACK_ENV_KEYS, env);
}

export function getMissingApiKeyError(providerId: string): string {
	const expectedKeys = [
		...new Set([
			...getProviderEnvKeys(providerId),
			...DEFAULT_FALLBACK_ENV_KEYS,
		]),
	];
	const keysMessage =
		expectedKeys.length > 0
			? expectedKeys.join(", ")
			: "provider-specific API key env var";
	return `Missing API key for provider "${normalizeProviderId(providerId)}". Set apiKey explicitly or one of: ${keysMessage}.`;
}
