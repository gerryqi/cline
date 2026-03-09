import type { ModelCollection, ModelInfo } from "./models/index";
import type {
	ApiHandler,
	HandlerFactory,
	LazyHandlerFactory,
	ProviderCapability,
	ProviderConfig,
} from "./providers/index";

export type ProviderConfigDefaults = Omit<
	ProviderConfig,
	"providerId" | "modelId"
>;

export interface ProviderSelectionConfig {
	id: string;
	models: string[];
	defaultModel?: string;
	apiKey?: string;
	apiKeyEnv?: string;
	baseUrl?: string;
	headers?: Record<string, string>;
	timeoutMs?: number;
	capabilities?: ProviderCapability[];
	settings?: ProviderConfigDefaults;
}

export interface AdditionalModelConfig {
	providerId: string;
	modelId: string;
	info: ModelInfo;
}

export interface CustomProviderConfig {
	collection: ModelCollection;
	defaults?: ProviderConfigDefaults;
	handlerFactory?: HandlerFactory;
	asyncHandlerFactory?: LazyHandlerFactory;
}

export interface LlmsConfig {
	providers: ProviderSelectionConfig[];
	models?: AdditionalModelConfig[];
	customProviders?: CustomProviderConfig[];
}

export interface CreateHandlerInput {
	providerId: string;
	modelId?: string;
	overrides?: ProviderConfigDefaults;
}

export interface RegisteredProviderSummary {
	id: string;
	models: string[];
	defaultModel: string;
}

export interface RegisterProviderInput extends CustomProviderConfig {
	exposeModels?: string[];
	defaultModel?: string;
}

export interface RegisterModelInput {
	providerId: string;
	modelId: string;
	info: ModelInfo;
}

export interface LlmsSdk {
	createHandler(input: CreateHandlerInput): ApiHandler;
	createHandlerAsync(input: CreateHandlerInput): Promise<ApiHandler>;
	registerProvider(input: RegisterProviderInput): void;
	registerModel(input: RegisterModelInput): void;
	getProviders(): RegisteredProviderSummary[];
	getModels(providerId: string): string[];
	isProviderConfigured(providerId: string): boolean;
	isModelConfigured(providerId: string, modelId: string): boolean;
}
