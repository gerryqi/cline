import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateLegacyProviderSettings } from "./provider-settings-legacy-migration";
import { ProviderSettingsManager } from "./provider-settings-manager";

describe("migrateLegacyProviderSettings", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("migrates legacy provider state into providers.json when target is empty", () => {
		const tempDir = mkdtempSync(
			path.join(os.tmpdir(), "core-legacy-provider-"),
		);
		tempDirs.push(tempDir);
		const providersPath = path.join(tempDir, "settings", "providers.json");
		const manager = new ProviderSettingsManager({ filePath: providersPath });

		writeFileSync(
			path.join(tempDir, "globalState.json"),
			JSON.stringify(
				{
					mode: "act",
					actModeApiProvider: "anthropic",
					actModeApiModelId: "claude-sonnet-4-6",
					anthropicBaseUrl: "https://example.invalid/anthropic",
					actModeReasoningEffort: "high",
					actModeThinkingBudgetTokens: 2048,
					requestTimeoutMs: 90000,
				},
				null,
				2,
			),
		);
		writeFileSync(
			path.join(tempDir, "secrets.json"),
			JSON.stringify({ apiKey: "legacy-anthropic-key" }, null, 2),
		);

		const result = migrateLegacyProviderSettings({
			providerSettingsManager: manager,
			dataDir: tempDir,
		});

		expect(result).toMatchObject({
			migrated: true,
			providerCount: 1,
			lastUsedProvider: "anthropic",
		});
		expect(manager.getProviderSettings("anthropic")).toEqual({
			provider: "anthropic",
			model: "claude-sonnet-4-6",
			apiKey: "legacy-anthropic-key",
			baseUrl: "https://example.invalid/anthropic",
			timeout: 90000,
			reasoning: {
				effort: "high",
				budgetTokens: 2048,
			},
		});
		expect(manager.read().providers.anthropic?.tokenSource).toBe("migration");
	});

	it("migrates missing providers without overwriting existing providers", () => {
		const tempDir = mkdtempSync(
			path.join(os.tmpdir(), "core-legacy-provider-"),
		);
		tempDirs.push(tempDir);
		const providersPath = path.join(tempDir, "settings", "providers.json");
		const manager = new ProviderSettingsManager({ filePath: providersPath });

		manager.saveProviderSettings({
			provider: "openai",
			model: "gpt-5",
			apiKey: "already-migrated",
		});
		writeFileSync(
			path.join(tempDir, "globalState.json"),
			JSON.stringify(
				{
					mode: "act",
					actModeApiProvider: "anthropic",
				},
				null,
				2,
			),
		);
		writeFileSync(
			path.join(tempDir, "secrets.json"),
			JSON.stringify({ apiKey: "legacy-key" }, null, 2),
		);

		const result = migrateLegacyProviderSettings({
			providerSettingsManager: manager,
			dataDir: tempDir,
		});

		expect(result.migrated).toBe(true);
		expect(manager.getProviderSettings("openai")?.apiKey).toBe(
			"already-migrated",
		);
		expect(manager.getProviderSettings("anthropic")).toEqual({
			provider: "anthropic",
			apiKey: "legacy-key",
		});
		expect(manager.read().providers.openai?.tokenSource).toBe("manual");
		expect(manager.read().providers.anthropic?.tokenSource).toBe("migration");
	});

	it("migrates legacy OpenAI Codex OAuth credentials", () => {
		const tempDir = mkdtempSync(
			path.join(os.tmpdir(), "core-legacy-provider-"),
		);
		tempDirs.push(tempDir);
		const providersPath = path.join(tempDir, "settings", "providers.json");
		const manager = new ProviderSettingsManager({ filePath: providersPath });

		writeFileSync(
			path.join(tempDir, "globalState.json"),
			JSON.stringify(
				{
					mode: "act",
					actModeApiProvider: "openai-codex",
				},
				null,
				2,
			),
		);
		writeFileSync(
			path.join(tempDir, "secrets.json"),
			JSON.stringify(
				{
					"openai-codex-oauth-credentials": JSON.stringify({
						type: "openai-codex",
						access_token: "legacy-access",
						refresh_token: "legacy-refresh",
						expires: Date.now() + 60_000,
						accountId: "acct_123",
					}),
				},
				null,
				2,
			),
		);

		const result = migrateLegacyProviderSettings({
			providerSettingsManager: manager,
			dataDir: tempDir,
		});

		expect(result).toMatchObject({
			migrated: true,
			lastUsedProvider: "openai-codex",
		});
		expect(manager.getProviderSettings("openai-codex")).toEqual({
			provider: "openai-codex",
			apiKey: "legacy-access",
			auth: {
				accessToken: "legacy-access",
				refreshToken: "legacy-refresh",
				accountId: "acct_123",
			},
		});
		expect(manager.read().providers["openai-codex"]?.tokenSource).toBe(
			"migration",
		);
	});
});
