import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProviderSettingsManager } from "./provider-settings-manager";

describe("ProviderSettingsManager", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("persists and restores provider settings", () => {
		const tempDir = mkdtempSync(
			path.join(os.tmpdir(), "core-provider-settings-"),
		);
		tempDirs.push(tempDir);
		const filePath = path.join(tempDir, "provider-settings.json");
		const manager = new ProviderSettingsManager({ filePath });

		manager.saveProviderSettings(
			{
				provider: "anthropic",
				model: "claude-sonnet-4-6",
				apiKey: "test-key",
			},
			{ setLastUsed: true },
		);

		const reloaded = new ProviderSettingsManager({ filePath });
		expect(reloaded.getLastUsedProviderSettings()).toEqual({
			provider: "anthropic",
			model: "claude-sonnet-4-6",
			apiKey: "test-key",
		});
		expect(reloaded.getProviderConfig("anthropic")?.providerId).toBe(
			"anthropic",
		);
		expect(reloaded.getProviderConfig("anthropic")?.modelId).toBe(
			"claude-sonnet-4-6",
		);
	});

	it("tracks provider-specific settings while preserving last-used provider", () => {
		const tempDir = mkdtempSync(
			path.join(os.tmpdir(), "core-provider-settings-"),
		);
		tempDirs.push(tempDir);
		const filePath = path.join(tempDir, "provider-settings.json");
		const manager = new ProviderSettingsManager({ filePath });

		manager.saveProviderSettings({
			provider: "anthropic",
			model: "claude-sonnet-4-6",
		});
		manager.saveProviderSettings(
			{
				provider: "openai-native",
				model: "gpt-5",
			},
			{ setLastUsed: false },
		);

		expect(manager.getProviderSettings("anthropic")?.model).toBe(
			"claude-sonnet-4-6",
		);
		expect(manager.getProviderSettings("openai-native")?.model).toBe("gpt-5");
		expect(manager.getLastUsedProviderSettings()?.provider).toBe("anthropic");
	});

	it("ignores invalid persisted JSON and falls back to empty state", () => {
		const tempDir = mkdtempSync(
			path.join(os.tmpdir(), "core-provider-settings-"),
		);
		tempDirs.push(tempDir);
		const filePath = path.join(tempDir, "provider-settings.json");
		writeFileSync(filePath, "{ not-json", "utf8");

		const manager = new ProviderSettingsManager({ filePath });
		expect(manager.read()).toEqual({
			version: 1,
			providers: {},
		});
	});
});
