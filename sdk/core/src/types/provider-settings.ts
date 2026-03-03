import {
	type ProviderConfig,
	type ProviderSettings,
	ProviderSettingsSchema,
	toProviderConfig,
} from "@cline/llms/providers";
import { z } from "zod";

export {
	type ProviderConfig,
	type ProviderSettings,
	ProviderSettingsSchema,
	toProviderConfig,
};

export interface StoredProviderSettingsEntry {
	settings: ProviderSettings;
	updatedAt: string;
}

export interface StoredProviderSettings {
	version: 1;
	lastUsedProvider?: string;
	providers: Record<string, StoredProviderSettingsEntry>;
}

export const StoredProviderSettingsEntrySchema: z.ZodType<StoredProviderSettingsEntry> =
	z.object({
		settings: ProviderSettingsSchema,
		updatedAt: z.string().datetime(),
	});

export const StoredProviderSettingsSchema: z.ZodType<StoredProviderSettings> =
	z.object({
		version: z.literal(1),
		lastUsedProvider: z.string().min(1).optional(),
		providers: z.record(StoredProviderSettingsEntrySchema),
	});

export function emptyStoredProviderSettings(): StoredProviderSettings {
	return {
		version: 1,
		providers: {},
	};
}
