import type { ProviderCapability } from "./models/schemas/index";
import {
	buildOpenAICompatibleProviderDefaults,
	type OpenAICompatibleProviderDefaults,
} from "./providers/shared/openai-compatible";

export * as models from "./models/index";
export type { ProviderCapability } from "./models/schemas/index";

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
