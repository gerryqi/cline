import { spawn } from "node:child_process";
import {
	createOAuthClientCallbacks,
	loginClineOAuth,
	loginOcaOAuth,
	loginOpenAICodex,
	type ProviderSettingsManager,
} from "@cline/core/server";
import type { providers as LlmsProviders } from "@cline/llms";
import type { RpcOAuthProviderId } from "@cline/shared";

export function normalizeOAuthProvider(provider: string): RpcOAuthProviderId {
	const normalized = provider.trim().toLowerCase();
	if (normalized === "codex" || normalized === "openai-codex") {
		return "openai-codex";
	}
	if (normalized === "cline" || normalized === "oca") {
		return normalized;
	}
	throw new Error(
		`provider "${provider}" does not support OAuth login (supported: cline, oca, openai-codex)`,
	);
}

function openUrl(url: string): void {
	const platform = process.platform;
	const command =
		platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
	const args =
		platform === "darwin"
			? [url]
			: platform === "win32"
				? ["/c", "start", "", url]
				: [url];
	const child = spawn(command, args, {
		stdio: "ignore",
		detached: true,
	});
	child.unref();
}

function toProviderApiKey(
	providerId: RpcOAuthProviderId,
	credentials: { access: string },
): string {
	if (providerId === "cline") {
		return `workos:${credentials.access}`;
	}
	return credentials.access;
}

export async function loginProvider(
	providerId: RpcOAuthProviderId,
	existing: LlmsProviders.ProviderSettings | undefined,
): Promise<{
	access: string;
	refresh: string;
	expires: number;
	accountId?: string;
}> {
	const callbacks = createOAuthClientCallbacks({
		onPrompt: async (prompt) => prompt.defaultValue ?? "",
		openUrl: (url) => openUrl(url),
		onOpenUrlError: ({ error }) => {
			throw error instanceof Error ? error : new Error(String(error));
		},
	});

	if (providerId === "cline") {
		return loginClineOAuth({
			apiBaseUrl: existing?.baseUrl?.trim() || "https://api.cline.bot",
			callbacks,
		});
	}
	if (providerId === "oca") {
		return loginOcaOAuth({
			mode: existing?.oca?.mode,
			callbacks,
		});
	}
	return loginOpenAICodex(callbacks);
}

export function saveProviderOAuthCredentials(
	manager: ProviderSettingsManager,
	providerId: RpcOAuthProviderId,
	existing: LlmsProviders.ProviderSettings | undefined,
	credentials: {
		access: string;
		refresh: string;
		expires: number;
		accountId?: string;
	},
): LlmsProviders.ProviderSettings {
	const auth = {
		...(existing?.auth ?? {}),
		accessToken: toProviderApiKey(providerId, credentials),
		refreshToken: credentials.refresh,
		accountId: credentials.accountId,
	} as LlmsProviders.ProviderSettings["auth"] & { expiresAt?: number };
	auth.expiresAt = credentials.expires;
	const merged: LlmsProviders.ProviderSettings = {
		...(existing ?? {
			provider: providerId as LlmsProviders.ProviderSettings["provider"],
		}),
		provider: providerId as LlmsProviders.ProviderSettings["provider"],
		auth,
	};
	manager.saveProviderSettings(merged, { tokenSource: "oauth" });
	return merged;
}

export function resolveClineAuthToken(
	settings: LlmsProviders.ProviderSettings | undefined,
): string | undefined {
	const token = settings?.auth?.accessToken?.trim() || settings?.apiKey?.trim();
	return token && token.length > 0 ? token : undefined;
}
