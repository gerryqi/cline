import { readFileSync } from "node:fs";
import { ProviderSettingsManager } from "@cline/core/server";
import { models } from "@cline/llms";

interface ProviderModel {
	id: string;
	name: string;
	supportsAttachments?: boolean;
	supportsVision?: boolean;
}

interface ProviderListItem {
	id: string;
	name: string;
	models: number | null;
	color: string;
	letter: string;
	enabled: boolean;
	apiKey?: string;
	baseUrl?: string;
	defaultModelId?: string;
	authDescription: string;
	baseUrlDescription: string;
}

type RequestBody =
	| { action: "listProviders" }
	| { action: "getProviderModels"; providerId: string }
	| {
			action: "saveProviderSettings";
			providerId: string;
			enabled?: boolean;
			apiKey?: string;
			baseUrl?: string;
	  };

function resolveVisibleApiKey(settings: {
	apiKey?: string;
	auth?: {
		apiKey?: string;
	};
}): string | undefined {
	return settings.apiKey ?? settings.auth?.apiKey;
}

function readStdin(): string {
	return readFileSync(0, "utf8");
}

function titleCaseFromId(id: string): string {
	return id
		.split(/[-_]/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

function createLetter(name: string): string {
	const parts = name
		.split(/\s+/)
		.map((part) => part.trim())
		.filter(Boolean);
	if (parts.length === 0) {
		return "?";
	}
	if (parts.length === 1) {
		return parts[0].slice(0, 2).toUpperCase();
	}
	return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function stableColor(id: string): string {
	const palette = [
		"#c4956a",
		"#6b8aad",
		"#e8963a",
		"#5b9bd5",
		"#6bbd7b",
		"#9b7dd4",
		"#d07f68",
		"#57a6a1",
	];
	let hash = 0;
	for (const ch of id) {
		hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
	}
	return palette[hash % palette.length];
}

function normalizeProviderId(providerId: string): string {
	return providerId.trim();
}

async function listProviders(manager: ProviderSettingsManager): Promise<{
	providers: ProviderListItem[];
	settingsPath: string;
}> {
	const state = manager.read();
	const ids = models.getProviderIds().sort((a, b) => a.localeCompare(b));
	const providerItems = await Promise.all(
		ids.map(async (id): Promise<ProviderListItem> => {
			const info = await models.getProvider(id);
			const persistedSettings = state.providers[id]?.settings;
			const providerName = info?.name ?? titleCaseFromId(id);
			return {
				id,
				name: providerName,
				models: null,
				color: stableColor(id),
				letter: createLetter(providerName),
				enabled: Boolean(persistedSettings),
				apiKey: persistedSettings
					? resolveVisibleApiKey(persistedSettings)
					: undefined,
				baseUrl: persistedSettings?.baseUrl ?? info?.baseUrl,
				defaultModelId: info?.defaultModelId,
				authDescription: "This provider uses API keys for authentication.",
				baseUrlDescription: "The base endpoint to use for provider requests.",
			};
		}),
	);

	return {
		providers: providerItems,
		settingsPath: manager.getFilePath(),
	};
}

async function getProviderModels(
	providerId: string,
): Promise<{ providerId: string; models: ProviderModel[] }> {
	const id = normalizeProviderId(providerId);
	const modelMap = await models.getModelsForProvider(id);
	const items = Object.entries(modelMap)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([modelId, info]) => ({
			id: modelId,
			name: info.name ?? modelId,
			supportsAttachments: info.capabilities?.includes("files"),
			supportsVision: info.capabilities?.includes("images"),
		}));
	return {
		providerId: id,
		models: items,
	};
}

function saveProviderSettings(
	manager: ProviderSettingsManager,
	request: Extract<RequestBody, { action: "saveProviderSettings" }>,
): { providerId: string; enabled: boolean; settingsPath: string } {
	const providerId = normalizeProviderId(request.providerId);
	const state = manager.read();

	if (request.enabled === false) {
		delete state.providers[providerId];
		if (state.lastUsedProvider === providerId) {
			delete state.lastUsedProvider;
		}
		manager.write(state);
		return {
			providerId,
			enabled: false,
			settingsPath: manager.getFilePath(),
		};
	}

	const existing = manager.getProviderSettings(providerId);
	const nextSettings: Record<string, unknown> = {
		...(existing ?? {}),
		provider: providerId,
	};

	if ("apiKey" in request) {
		const apiKey = request.apiKey?.trim() ?? "";
		if (apiKey.length === 0) {
			delete nextSettings.apiKey;
		} else {
			nextSettings.apiKey = request.apiKey;
		}
	}

	if ("baseUrl" in request) {
		const baseUrl = request.baseUrl?.trim() ?? "";
		if (baseUrl.length === 0) {
			delete nextSettings.baseUrl;
		} else {
			nextSettings.baseUrl = baseUrl;
		}
	}

	manager.saveProviderSettings(nextSettings, { setLastUsed: false });

	return {
		providerId,
		enabled: true,
		settingsPath: manager.getFilePath(),
	};
}

async function main() {
	const parsed = JSON.parse(readStdin()) as RequestBody;
	const manager = new ProviderSettingsManager();

	if (parsed.action === "listProviders") {
		process.stdout.write(`${JSON.stringify(await listProviders(manager))}\n`);
		return;
	}

	if (parsed.action === "getProviderModels") {
		process.stdout.write(
			`${JSON.stringify(await getProviderModels(parsed.providerId))}\n`,
		);
		return;
	}

	process.stdout.write(
		`${JSON.stringify(saveProviderSettings(manager, parsed))}\n`,
	);
}

main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(message);
	process.exit(1);
});
