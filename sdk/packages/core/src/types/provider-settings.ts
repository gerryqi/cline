import { providers } from "@clinebot/llms";
import { z } from "zod";

export type ProviderConfig = providers.ProviderConfig;
export type ProviderSettings = providers.ProviderSettings;
export const ProviderSettingsSchema: z.ZodType<ProviderSettings> =
	providers.ProviderSettingsSchema;
export const toProviderConfig = providers.toProviderConfig;

export type ProviderTokenSource = "manual" | "oauth" | "migration";

export interface StoredProviderSettingsEntry {
	settings: ProviderSettings;
	updatedAt: string;
	tokenSource: ProviderTokenSource;
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
		tokenSource: z.enum(["manual", "oauth", "migration"]).default("manual"),
	});

export const StoredProviderSettingsSchema: z.ZodType<StoredProviderSettings> =
	z.object({
		version: z.literal(1),
		lastUsedProvider: z.string().min(1).optional(),
		providers: z.record(z.string(), StoredProviderSettingsEntrySchema),
	});

export function emptyStoredProviderSettings(): StoredProviderSettings {
	return {
		version: 1,
		providers: {},
	};
}
