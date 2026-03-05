import { createInterface } from "node:readline";
import {
	createOAuthClientCallbacks,
	type ProviderSettingsManager,
} from "@cline/core/server";
import { providers } from "@cline/llms";
import open from "open";

const c = {
	reset: "\x1b[0m",
	dim: "\x1b[2m",
	cyan: "\x1b[36m",
	green: "\x1b[32m",
};

export type OAuthCredentials = {
	access: string;
	refresh: string;
	expires: number;
	accountId?: string;
	email?: string;
	metadata?: Record<string, unknown>;
};

type CoreOAuthApi = {
	loginClineOAuth: (input: {
		apiBaseUrl: string;
		callbacks: {
			onAuth: (info: { url: string; instructions?: string }) => void;
			onPrompt: (prompt: {
				message: string;
				defaultValue?: string;
			}) => Promise<string>;
			onManualCodeInput?: () => Promise<string>;
		};
	}) => Promise<OAuthCredentials>;
	loginOcaOAuth: (input: {
		mode?: "internal" | "external";
		callbacks: {
			onAuth: (info: { url: string; instructions?: string }) => void;
			onPrompt: (prompt: {
				message: string;
				defaultValue?: string;
			}) => Promise<string>;
			onManualCodeInput?: () => Promise<string>;
		};
	}) => Promise<OAuthCredentials>;
	loginOpenAICodex: (input: {
		onAuth: (info: { url: string; instructions?: string }) => void;
		onPrompt: (prompt: {
			message: string;
			defaultValue?: string;
		}) => Promise<string>;
		onManualCodeInput?: () => Promise<string>;
	}) => Promise<OAuthCredentials>;
};

type AuthIo = {
	writeln: (text?: string) => void;
	writeErr: (text: string) => void;
};

let cachedCoreOAuthApi: Promise<CoreOAuthApi> | undefined;

async function getCoreOAuthApi(): Promise<CoreOAuthApi> {
	if (!cachedCoreOAuthApi) {
		cachedCoreOAuthApi = import("@cline/core/server").then((module) => {
			const runtimeApi = module as Partial<CoreOAuthApi>;
			if (
				typeof runtimeApi.loginClineOAuth !== "function" ||
				typeof runtimeApi.loginOcaOAuth !== "function" ||
				typeof runtimeApi.loginOpenAICodex !== "function"
			) {
				throw new Error(
					"Installed @cline/core does not expose OAuth login helpers required by the CLI",
				);
			}
			return runtimeApi as CoreOAuthApi;
		});
	}
	return cachedCoreOAuthApi;
}

export function normalizeProviderId(providerId: string): string {
	return providers.normalizeProviderId(providerId.trim());
}

export function normalizeAuthProviderId(providerId: string): string {
	const normalized = providerId.trim().toLowerCase();
	if (normalized === "codex" || normalized === "openai-codex") {
		return "openai-codex";
	}
	return normalizeProviderId(normalized);
}

export function isOAuthProvider(providerId: string): boolean {
	return (
		providerId === "cline" ||
		providerId === "oca" ||
		providerId === "openai-codex"
	);
}

export function toProviderApiKey(
	providerId: string,
	credentials: Pick<OAuthCredentials, "access">,
): string {
	if (providerId === "cline") {
		return `workos:${credentials.access}`;
	}
	return credentials.access;
}

export function getPersistedProviderApiKey(
	providerId: string,
	settings?: providers.ProviderSettings,
): string | undefined {
	// OAuth access token takes priority (most recent credential)
	const accessToken = settings?.auth?.accessToken?.trim();
	if (accessToken) {
		return toProviderApiKey(providerId, { access: accessToken });
	}
	const shorthandKey = settings?.apiKey?.trim();
	if (shorthandKey) {
		return shorthandKey;
	}
	const authKey = settings?.auth?.apiKey?.trim();
	if (authKey) {
		return authKey;
	}
	return undefined;
}

async function askForInputInTerminal(question: string): Promise<string> {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		throw new Error("OAuth login requires an interactive terminal session");
	}

	return new Promise<string>((resolve) => {
		const rl = createInterface({
			input: process.stdin,
			output: process.stdout,
		});
		rl.question(`${question} `, (value) => {
			rl.close();
			resolve(value);
		});
	});
}

function createOAuthCallbacks(io: AuthIo): {
	onAuth: (info: { url: string; instructions?: string }) => void;
	onPrompt: (prompt: {
		message: string;
		defaultValue?: string;
	}) => Promise<string>;
} {
	return createOAuthClientCallbacks({
		onPrompt: ({ message, defaultValue }) =>
			askForInputInTerminal(message).then((value) => {
				const trimmed = value.trim();
				return trimmed || defaultValue || "";
			}),
		onOutput: (message) => {
			io.writeln(`${c.dim}[auth] ${message}${c.reset}`);
		},
		openUrl: (url) => open(url, { wait: false }).then(() => undefined),
		onOpenUrlError: ({ error }) => {
			io.writeln(
				`${c.dim}[auth] Could not open browser automatically; open the URL above manually.${c.reset}`,
			);
			io.writeErr(error instanceof Error ? error.message : String(error));
		},
	});
}

async function loginWithOAuthProvider(
	providerId: string,
	existing: providers.ProviderSettings | undefined,
	io: AuthIo,
): Promise<OAuthCredentials> {
	const oauthApi = await getCoreOAuthApi();
	const callbacks = createOAuthCallbacks(io);

	if (providerId === "cline") {
		return oauthApi.loginClineOAuth({
			apiBaseUrl: existing?.baseUrl?.trim() || "https://api.cline.bot",
			callbacks,
		});
	}

	if (providerId === "oca") {
		const mode = existing?.oca?.mode;
		return oauthApi.loginOcaOAuth({
			mode,
			callbacks,
		});
	}

	if (providerId === "openai-codex") {
		return oauthApi.loginOpenAICodex(callbacks);
	}

	throw new Error(
		`Provider "${providerId}" does not support CLI OAuth flow (supported: cline, openai-codex, oca)`,
	);
}

export function saveOAuthProviderSettings(
	providerSettingsManager: ProviderSettingsManager,
	providerId: string,
	existing: providers.ProviderSettings | undefined,
	credentials: OAuthCredentials,
): providers.ProviderSettings {
	const merged: providers.ProviderSettings = {
		...(existing ?? {
			provider: providerId as providers.ProviderSettings["provider"],
		}),
		provider: providerId as providers.ProviderSettings["provider"],
		auth: {
			...(existing?.auth ?? {}),
			accessToken: toProviderApiKey(providerId, credentials),
			refreshToken: credentials.refresh,
			accountId: credentials.accountId,
		},
	};
	providerSettingsManager.saveProviderSettings(merged, {
		tokenSource: "oauth",
	});
	return merged;
}

export async function ensureOAuthProviderApiKey(input: {
	providerId: string;
	currentApiKey?: string;
	existingSettings?: providers.ProviderSettings;
	providerSettingsManager: ProviderSettingsManager;
	io: AuthIo;
}): Promise<{
	apiKey?: string;
	selectedProviderSettings?: providers.ProviderSettings;
}> {
	if (input.currentApiKey || !isOAuthProvider(input.providerId)) {
		return {
			apiKey: input.currentApiKey,
			selectedProviderSettings: input.existingSettings,
		};
	}
	const credentials = await loginWithOAuthProvider(
		input.providerId,
		input.existingSettings,
		input.io,
	);
	const selectedProviderSettings = saveOAuthProviderSettings(
		input.providerSettingsManager,
		input.providerId,
		input.existingSettings,
		credentials,
	);
	return {
		apiKey: toProviderApiKey(input.providerId, credentials),
		selectedProviderSettings,
	};
}

export async function runAuthProviderCommand(
	providerSettingsManager: ProviderSettingsManager,
	providerId: string,
	io: AuthIo,
): Promise<number> {
	if (!isOAuthProvider(providerId)) {
		io.writeErr(
			`provider "${providerId}" does not support OAuth login (supported: cline, openai-codex, oca)`,
		);
		return 1;
	}
	try {
		const existing = providerSettingsManager.getProviderSettings(providerId);
		const credentials = await loginWithOAuthProvider(providerId, existing, io);
		saveOAuthProviderSettings(
			providerSettingsManager,
			providerId,
			existing,
			credentials,
		);
		io.writeln(
			`${c.green}You are now logged in to ${c.cyan}${providerId}${c.reset}`,
		);
		return 0;
	} catch (error) {
		io.writeErr(error instanceof Error ? error.message : String(error));
		return 1;
	}
}
