import * as modelProviderExports from "../../models/providers/index.js";
import type { ModelCollection } from "../../models/schemas/index.js";

const PROVIDER_ID_ALIASES: Record<string, string> = {
	openai: "openai-native",
	togetherai: "together",
};

const DEFAULT_FALLBACK_PROVIDER_IDS = [
	"cline",
	"anthropic",
	"openai-native",
	"gemini",
] as const;

function isModelCollection(value: unknown): value is ModelCollection {
	if (!value || typeof value !== "object") {
		return false;
	}

	const maybeCollection = value as Partial<ModelCollection>;
	return (
		typeof maybeCollection.provider === "object" &&
		typeof maybeCollection.models === "object"
	);
}

function dedupe(values: readonly string[]): string[] {
	return [...new Set(values)];
}

function buildProviderEnvKeys(): Record<string, readonly string[]> {
	const envKeysByProvider: Record<string, readonly string[]> = {};

	for (const value of Object.values(modelProviderExports)) {
		if (!isModelCollection(value)) {
			continue;
		}

		const providerId = value.provider.id;
		envKeysByProvider[providerId] = dedupe(value.provider.env ?? []);
	}

	return envKeysByProvider;
}

const ENV_KEYS_BY_PROVIDER = buildProviderEnvKeys();
const DEFAULT_FALLBACK_ENV_KEYS = dedupe(
	DEFAULT_FALLBACK_PROVIDER_IDS.flatMap(
		(providerId) => ENV_KEYS_BY_PROVIDER[providerId] ?? [],
	),
);

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
