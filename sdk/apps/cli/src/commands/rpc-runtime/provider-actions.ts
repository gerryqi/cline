import {
	ClineAccountService,
	executeRpcClineAccountAction,
	ProviderSettingsManager,
} from "@cline/core/server";
import type {
	RpcClineAccountActionRequest,
	RpcOAuthProviderId,
	RpcProviderActionRequest,
} from "@cline/shared";
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
	requestJson: string,
): Promise<{ resultJson: string }> {
	const manager = new ProviderSettingsManager();
	await ensureCustomProvidersLoaded(manager);
	const parsed = JSON.parse(requestJson) as RpcProviderActionRequest;

	if (parsed.action === "clineAccount") {
		const settings = manager.getProviderSettings("cline");
		const accountService = new ClineAccountService({
			apiBaseUrl: settings?.baseUrl?.trim() || "https://api.cline.bot",
			getAuthToken: async () => resolveClineAuthToken(settings),
		});
		return {
			resultJson: JSON.stringify(
				await executeRpcClineAccountAction(
					parsed as RpcClineAccountActionRequest,
					accountService,
				),
			),
		};
	}
	if (parsed.action === "listProviders") {
		return { resultJson: JSON.stringify(await listProviders(manager)) };
	}
	if (parsed.action === "getProviderModels") {
		return {
			resultJson: JSON.stringify(await getProviderModels(parsed.providerId)),
		};
	}
	if (parsed.action === "addProvider") {
		return {
			resultJson: JSON.stringify(await addProvider(manager, parsed)),
		};
	}
	if (parsed.action === "saveProviderSettings") {
		return {
			resultJson: JSON.stringify(saveProviderSettings(manager, parsed)),
		};
	}
	throw new Error(`unsupported provider action: ${String(parsed)}`);
}

export async function runProviderOAuthLogin(
	provider: string,
): Promise<{ provider: RpcOAuthProviderId; apiKey: string }> {
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
		apiKey: resolvedKey,
	};
}
