import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import {
	createOAuthClientCallbacks,
	loginClineOAuth,
	loginOcaOAuth,
	loginOpenAICodex,
	ProviderSettingsManager,
} from "@cline/core/server";
import type { providers } from "@cline/llms";

type OAuthProviderId = "cline" | "oca" | "openai-codex";

type OAuthCredentials = {
	access: string;
	refresh: string;
	expires: number;
	accountId?: string;
	email?: string;
	metadata?: Record<string, unknown>;
};

type RequestBody = {
	provider: string;
};

function readStdin(): string {
	return readFileSync(0, "utf8");
}

function normalizeOAuthProvider(provider: string): OAuthProviderId {
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
	providerId: OAuthProviderId,
	credentials: Pick<OAuthCredentials, "access">,
): string {
	if (providerId === "cline") {
		return `workos:${credentials.access}`;
	}
	return credentials.access;
}

async function loginProvider(
	providerId: OAuthProviderId,
	existing: providers.ProviderSettings | undefined,
): Promise<OAuthCredentials> {
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

function saveProviderOAuthCredentials(
	manager: ProviderSettingsManager,
	providerId: OAuthProviderId,
	existing: providers.ProviderSettings | undefined,
	credentials: OAuthCredentials,
): providers.ProviderSettings {
	const apiKey = toProviderApiKey(providerId, credentials);
	const merged: providers.ProviderSettings = {
		...(existing ?? {
			provider: providerId as providers.ProviderSettings["provider"],
		}),
		provider: providerId as providers.ProviderSettings["provider"],
		apiKey,
		auth: {
			...(existing?.auth ?? {}),
			accessToken: credentials.access,
			refreshToken: credentials.refresh,
			accountId: credentials.accountId,
		},
	};
	manager.saveProviderSettings(merged);
	return merged;
}

async function main() {
	const raw = readStdin();
	const parsed = JSON.parse(raw) as RequestBody;
	const providerId = normalizeOAuthProvider(parsed.provider);
	const manager = new ProviderSettingsManager();
	const existing = manager.getProviderSettings(providerId);
	const credentials = await loginProvider(providerId, existing);
	const saved = saveProviderOAuthCredentials(
		manager,
		providerId,
		existing,
		credentials,
	);
	process.stdout.write(
		`${JSON.stringify({ provider: providerId, apiKey: saved.apiKey ?? "" })}\n`,
	);
}

main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(message);
	process.exit(1);
});
