import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
	emptyStoredProviderSettings,
	type ProviderConfig,
	type ProviderSettings,
	ProviderSettingsSchema,
	type StoredProviderSettings,
	StoredProviderSettingsSchema,
	toProviderConfig,
} from "../types/provider-settings";
import { resolveProviderSettingsPath } from "./paths";

function nowIso(): string {
	return new Date().toISOString();
}

export interface ProviderSettingsManagerOptions {
	filePath?: string;
}

export interface SaveProviderSettingsOptions {
	setLastUsed?: boolean;
}

export class ProviderSettingsManager {
	private readonly filePath: string;

	constructor(options: ProviderSettingsManagerOptions = {}) {
		this.filePath = options.filePath ?? resolveProviderSettingsPath();
	}

	getFilePath(): string {
		return this.filePath;
	}

	read(): StoredProviderSettings {
		if (!existsSync(this.filePath)) {
			return emptyStoredProviderSettings();
		}

		try {
			const raw = readFileSync(this.filePath, "utf8");
			const parsed = JSON.parse(raw) as unknown;
			const result = StoredProviderSettingsSchema.safeParse(parsed);
			if (result.success) {
				return result.data;
			}
		} catch {
			// Invalid content falls back to a clean state.
		}

		return emptyStoredProviderSettings();
	}

	write(state: StoredProviderSettings): void {
		const normalized = StoredProviderSettingsSchema.parse(state);
		const dir = dirname(this.filePath);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
		writeFileSync(
			this.filePath,
			`${JSON.stringify(normalized, null, 2)}\n`,
			"utf8",
		);
	}

	saveProviderSettings(
		settings: unknown,
		options: SaveProviderSettingsOptions = {},
	): StoredProviderSettings {
		const validatedSettings = ProviderSettingsSchema.parse(settings);
		const previous = this.read();
		const providerId = validatedSettings.provider;
		const shouldSetLastUsed = options.setLastUsed !== false;
		const next: StoredProviderSettings = {
			...previous,
			providers: {
				...previous.providers,
				[providerId]: {
					settings: validatedSettings,
					updatedAt: nowIso(),
				},
			},
			lastUsedProvider: shouldSetLastUsed
				? providerId
				: previous.lastUsedProvider,
		};
		this.write(next);
		return next;
	}

	getProviderSettings(providerId: string): ProviderSettings | undefined {
		const state = this.read();
		return state.providers[providerId]?.settings;
	}

	getLastUsedProviderSettings(): ProviderSettings | undefined {
		const state = this.read();
		const providerId = state.lastUsedProvider;
		if (!providerId) {
			return undefined;
		}
		return state.providers[providerId]?.settings;
	}

	getProviderConfig(providerId: string): ProviderConfig | undefined {
		const settings = this.getProviderSettings(providerId);
		if (!settings) {
			return undefined;
		}
		return toProviderConfig(settings);
	}

	getLastUsedProviderConfig(): ProviderConfig | undefined {
		const settings = this.getLastUsedProviderSettings();
		if (!settings) {
			return undefined;
		}
		return toProviderConfig(settings);
	}
}
