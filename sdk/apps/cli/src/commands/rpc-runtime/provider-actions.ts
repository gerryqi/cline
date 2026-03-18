import {
	ClineAccountService,
	executeRpcClineAccountAction,
	ProviderSettingsManager,
} from "@clinebot/core/server";
import type {
	RpcClineAccountActionRequest,
	RpcOAuthProviderId,
	RpcProviderActionRequest,
} from "@clinebot/shared";
import {
	loginProvider,
	normalizeOAuthProvider,
	resolveClineAuthToken,
	saveProviderOAuthCredentials,
} from "./provider-oauth";
import {
	addProvider,
	ensureCustomProvidersLoaded,
	getProviderModels,
	listProviders,
	saveProviderSettings,
} from "./provider-registry";

export async function runProviderAction(
	request: RpcProviderActionRequest,
): Promise<{ result: unknown }> {
	const manager = new ProviderSettingsManager();
	await ensureCustomProvidersLoaded(manager);
	const parsed = request;

	if (parsed.action === "clineAccount") {
		const settings = manager.getProviderSettings("cline");
		const accountService = new ClineAccountService({
			apiBaseUrl: settings?.baseUrl?.trim() || "https://api.cline.bot",
			getAuthToken: async () => resolveClineAuthToken(settings),
		});
		return {
			result: await executeRpcClineAccountAction(
				parsed as RpcClineAccountActionRequest,
				accountService,
			),
		};
	}
	if (parsed.action === "listProviders") {
		return { result: await listProviders(manager) };
	}
	if (parsed.action === "getProviderModels") {
		return { result: await getProviderModels(parsed.providerId) };
	}
	if (parsed.action === "addProvider") {
		return { result: await addProvider(manager, parsed) };
	}
	if (parsed.action === "saveProviderSettings") {
		return { result: saveProviderSettings(manager, parsed) };
	}
	throw new Error(`unsupported provider action: ${String(parsed)}`);
}

export async function runProviderOAuthLogin(
	provider: string,
): Promise<{ provider: RpcOAuthProviderId; accessToken: string }> {
	const providerId = normalizeOAuthProvider(provider);
	const manager = new ProviderSettingsManager();
	const existing = manager.getProviderSettings(providerId);
	const credentials = await loginProvider(providerId, existing);
	const saved = saveProviderOAuthCredentials(
		manager,
		providerId,
		existing,
		credentials,
	);
	const resolvedKey = saved.auth?.accessToken ?? saved.apiKey ?? "";
	return {
		provider: providerId,
		accessToken: resolvedKey,
	};
}
