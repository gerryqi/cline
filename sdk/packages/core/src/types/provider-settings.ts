import { providers } from "@cline/llms";
import { z } from "zod";

export type ProviderConfig = providers.ProviderConfig;
export type ProviderSettings = providers.ProviderSettings;
export const ProviderSettingsSchema: z.ZodType<ProviderSettings> =
	providers.ProviderSettingsSchema;
export const toProviderConfig = providers.toProviderConfig;

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
		settings: providers.ProviderSettingsSchema,
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
