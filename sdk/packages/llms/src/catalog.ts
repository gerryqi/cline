import type { ProviderCapability } from "./models/schemas/index.js";
import {
	buildOpenAICompatibleProviderDefaults,
	type OpenAICompatibleProviderDefaults,
} from "./providers/shared/openai-compatible.js";

export * as models from "./models/index.js";
export type { ProviderCapability } from "./models/schemas/index.js";

export interface CatalogProviderDefaults
	extends Omit<OpenAICompatibleProviderDefaults, "capabilities"> {
	capabilities?: ProviderCapability[];
}

export const OPENAI_COMPATIBLE_PROVIDERS: Record<
	string,
	CatalogProviderDefaults
> = buildOpenAICompatibleProviderDefaults({
	includeKnownModels: true,
});
