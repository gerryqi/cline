import type { ProviderSettingsManager } from "@cline/core/server";
import type { RpcSaveProviderSettingsActionRequest } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import { saveProviderSettings } from "./provider-registry";

describe("saveProviderSettings", () => {
	it("ignores null apiKey/baseUrl updates", () => {
		const save = vi.fn();
		const manager = {
			read: vi.fn().mockReturnValue({
				providers: {},
			}),
			write: vi.fn(),
			getFilePath: vi.fn().mockReturnValue("/tmp/providers.json"),
			getProviderSettings: vi.fn().mockReturnValue({
				provider: "openai",
				apiKey: "existing-key",
				baseUrl: "https://api.example.com",
			}),
			saveProviderSettings: save,
		};

		saveProviderSettings(
			manager as unknown as ProviderSettingsManager,
			{
				action: "saveProviderSettings",
				providerId: "openai",
				apiKey: null,
				baseUrl: null,
			} as unknown as RpcSaveProviderSettingsActionRequest,
		);

		expect(save).toHaveBeenCalledTimes(1);
		expect(save).toHaveBeenCalledWith(
			{
				provider: "openai",
				apiKey: "existing-key",
				baseUrl: "https://api.example.com",
			},
			{ setLastUsed: false },
		);
	});

	it("clears apiKey/baseUrl when explicit blank strings are provided", () => {
		const save = vi.fn();
		const manager = {
			read: vi.fn().mockReturnValue({
				providers: {},
			}),
			write: vi.fn(),
			getFilePath: vi.fn().mockReturnValue("/tmp/providers.json"),
			getProviderSettings: vi.fn().mockReturnValue({
				provider: "openai",
				apiKey: "existing-key",
				baseUrl: "https://api.example.com",
			}),
			saveProviderSettings: save,
		};

		saveProviderSettings(
			manager as unknown as ProviderSettingsManager,
			{
				action: "saveProviderSettings",
				providerId: "openai",
				apiKey: "   ",
				baseUrl: "",
			} as RpcSaveProviderSettingsActionRequest,
		);

		expect(save).toHaveBeenCalledTimes(1);
		expect(save).toHaveBeenCalledWith(
			{
				provider: "openai",
			},
			{ setLastUsed: false },
		);
	});
});
