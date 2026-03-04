import {
	hasProvider,
	registerModel as registerModelInCatalog,
	registerProvider as registerProviderInCatalog,
} from "./models/index.js";
import {
	type ApiHandler,
	createHandler as createProviderHandler,
	createHandlerAsync as createProviderHandlerAsync,
	registerAsyncHandler,
	registerHandler,
} from "./providers/index.js";
import type {
	CreateHandlerInput,
	LlmsConfig,
	LlmsSdk,
	ProviderConfigDefaults,
	RegisteredProviderSummary,
	RegisterModelInput,
	RegisterProviderInput,
} from "./types.js";

interface InternalProviderConfig {
	id: string;
	models: Set<string>;
	defaultModel: string;
	defaults: ProviderConfigDefaults;
}

function cloneDefaults(
	defaults: ProviderConfigDefaults | undefined,
): ProviderConfigDefaults {
	return defaults ? { ...defaults } : {};
}

function resolveApiKey(
	apiKey?: string,
	apiKeyEnv?: string,
): string | undefined {
	if (apiKey) {
		return apiKey;
	}

	if (!apiKeyEnv) {
		return undefined;
	}

	const runtimeProcess = globalThis.process;
	if (!runtimeProcess?.env) {
		return undefined;
	}

	return runtimeProcess.env[apiKeyEnv];
}

function assertNonEmptyModels(providerId: string, models: string[]): void {
	if (!models.length) {
		throw new Error(
			`Provider "${providerId}" must include at least one model.`,
		);
	}
}

export class DefaultLlmsSdk implements LlmsSdk {
	private readonly providerConfigs = new Map<string, InternalProviderConfig>();

	constructor(config: LlmsConfig) {
		this.applyConfig(config);
	}

	createHandler(input: CreateHandlerInput): ApiHandler {
		const providerConfig = this.requireConfiguredProvider(input.providerId);
		const modelId = input.modelId ?? providerConfig.defaultModel;

		if (!providerConfig.models.has(modelId)) {
			throw new Error(
				`Model "${modelId}" is not configured for provider "${input.providerId}".`,
			);
		}

		return createProviderHandler({
			providerId: input.providerId,
			modelId,
			...providerConfig.defaults,
			...input.overrides,
		});
	}

	async createHandlerAsync(input: CreateHandlerInput): Promise<ApiHandler> {
		const providerConfig = this.requireConfiguredProvider(input.providerId);
		const modelId = input.modelId ?? providerConfig.defaultModel;

		if (!providerConfig.models.has(modelId)) {
			throw new Error(
				`Model "${modelId}" is not configured for provider "${input.providerId}".`,
			);
		}

		return createProviderHandlerAsync({
			providerId: input.providerId,
			modelId,
			...providerConfig.defaults,
			...input.overrides,
		});
	}

	registerProvider(input: RegisterProviderInput): void {
		registerProviderInCatalog(input.collection);

		if (input.handlerFactory && input.asyncHandlerFactory) {
			throw new Error(
				`Provider "${input.collection.provider.id}" cannot register both sync and async handlers.`,
			);
		}

		if (input.handlerFactory) {
			registerHandler(input.collection.provider.id, input.handlerFactory);
		}

		if (input.asyncHandlerFactory) {
			registerAsyncHandler(
				input.collection.provider.id,
				input.asyncHandlerFactory,
			);
		}

		const exposedModels =
			input.exposeModels ?? Object.keys(input.collection.models);
		assertNonEmptyModels(input.collection.provider.id, exposedModels);

		const existing = this.providerConfigs.get(input.collection.provider.id);
		const defaultModel =
			input.defaultModel ??
			input.collection.provider.defaultModelId ??
			exposedModels[0];

		if (!defaultModel) {
			throw new Error(
				`Provider "${input.collection.provider.id}" must define a default model.`,
			);
		}

		if (!exposedModels.includes(defaultModel)) {
			throw new Error(
				`Default model "${defaultModel}" is not included in configured models for "${input.collection.provider.id}".`,
			);
		}

		const mergedModels = new Set<string>([
			...(existing?.models ?? []),
			...exposedModels,
		]);
		const mergedDefaults = {
			...(existing?.defaults ?? {}),
			...cloneDefaults(input.defaults),
		};

		this.providerConfigs.set(input.collection.provider.id, {
			id: input.collection.provider.id,
			models: mergedModels,
			defaultModel,
			defaults: mergedDefaults,
		});
	}

	registerModel(input: RegisterModelInput): void {
		registerModelInCatalog(input.providerId, input.modelId, input.info);

		const existing = this.providerConfigs.get(input.providerId);
		if (!existing) {
			this.providerConfigs.set(input.providerId, {
				id: input.providerId,
				models: new Set([input.modelId]),
				defaultModel: input.modelId,
				defaults: {},
			});
			return;
		}

		existing.models.add(input.modelId);
	}

	getProviders(): RegisteredProviderSummary[] {
		return Array.from(this.providerConfigs.values()).map((provider) => ({
			id: provider.id,
			models: Array.from(provider.models),
			defaultModel: provider.defaultModel,
		}));
	}

	getModels(providerId: string): string[] {
		return Array.from(this.requireConfiguredProvider(providerId).models);
	}

	isProviderConfigured(providerId: string): boolean {
		return this.providerConfigs.has(providerId);
	}

	isModelConfigured(providerId: string, modelId: string): boolean {
		return this.providerConfigs.get(providerId)?.models.has(modelId) ?? false;
	}

	private applyConfig(config: LlmsConfig): void {
		for (const provider of config.providers) {
			assertNonEmptyModels(provider.id, provider.models);

			if (
				provider.defaultModel &&
				!provider.models.includes(provider.defaultModel)
			) {
				throw new Error(
					`Default model "${provider.defaultModel}" is not included in configured models for "${provider.id}".`,
				);
			}

			const defaultModel = provider.defaultModel ?? provider.models[0];
			if (!defaultModel) {
				throw new Error(
					`Provider "${provider.id}" must define a default model.`,
				);
			}

			const apiKey = resolveApiKey(provider.apiKey, provider.apiKeyEnv);

			this.providerConfigs.set(provider.id, {
				id: provider.id,
				models: new Set(provider.models),
				defaultModel,
				defaults: {
					apiKey,
					baseUrl: provider.baseUrl,
					headers: provider.headers,
					timeoutMs: provider.timeoutMs,
					capabilities: provider.capabilities,
					...cloneDefaults(provider.settings),
				},
			});
		}

		for (const model of config.models ?? []) {
			this.registerModel(model);
		}

		for (const provider of config.customProviders ?? []) {
			this.registerProvider(provider);
		}

		for (const providerConfig of this.providerConfigs.values()) {
			const providerExists = hasProvider(providerConfig.id);
			if (!providerExists) {
				throw new Error(
					`Provider "${providerConfig.id}" is not known. Register it through customProviders/registerProvider or use a built-in provider ID.`,
				);
			}
		}
	}

	private requireConfiguredProvider(
		providerId: string,
	): InternalProviderConfig {
		const providerConfig = this.providerConfigs.get(providerId);
		if (!providerConfig) {
			throw new Error(
				`Provider "${providerId}" is not configured in this SDK instance.`,
			);
		}

		return providerConfig;
	}
}

export function createLlmsSdk(config: LlmsConfig): LlmsSdk {
	return new DefaultLlmsSdk(config);
}
