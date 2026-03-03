import { afterEach, describe, expect, it } from "vitest";
import {
	resolveClineDataDir,
	resolveProviderSettingsPath,
	resolveSessionDataDir,
} from "./paths";

type EnvSnapshot = {
	CLINE_DATA_DIR: string | undefined;
	CLINE_SESSION_DATA_DIR: string | undefined;
	CLINE_PROVIDER_SETTINGS_PATH: string | undefined;
};

function captureEnv(): EnvSnapshot {
	return {
		CLINE_DATA_DIR: process.env.CLINE_DATA_DIR,
		CLINE_SESSION_DATA_DIR: process.env.CLINE_SESSION_DATA_DIR,
		CLINE_PROVIDER_SETTINGS_PATH: process.env.CLINE_PROVIDER_SETTINGS_PATH,
	};
}

function restoreEnv(snapshot: EnvSnapshot): void {
	process.env.CLINE_DATA_DIR = snapshot.CLINE_DATA_DIR;
	process.env.CLINE_SESSION_DATA_DIR = snapshot.CLINE_SESSION_DATA_DIR;
	process.env.CLINE_PROVIDER_SETTINGS_PATH =
		snapshot.CLINE_PROVIDER_SETTINGS_PATH;
}

describe("storage path resolution", () => {
	let snapshot: EnvSnapshot = captureEnv();

	afterEach(() => {
		restoreEnv(snapshot);
	});

	it("derives provider/session paths from CLINE_DATA_DIR", () => {
		snapshot = captureEnv();
		process.env.CLINE_DATA_DIR = "/tmp/cline-data";
		delete process.env.CLINE_SESSION_DATA_DIR;
		delete process.env.CLINE_PROVIDER_SETTINGS_PATH;

		expect(resolveClineDataDir()).toBe("/tmp/cline-data");
		expect(resolveSessionDataDir()).toBe("/tmp/cline-data/sessions");
		expect(resolveProviderSettingsPath()).toBe(
			"/tmp/cline-data/settings/providers.json",
		);
	});

	it("prefers specific overrides when provided", () => {
		snapshot = captureEnv();
		process.env.CLINE_DATA_DIR = "/tmp/cline-data";
		process.env.CLINE_SESSION_DATA_DIR = "/tmp/custom-sessions";
		process.env.CLINE_PROVIDER_SETTINGS_PATH = "/tmp/custom/providers.json";

		expect(resolveSessionDataDir()).toBe("/tmp/custom-sessions");
		expect(resolveProviderSettingsPath()).toBe("/tmp/custom/providers.json");
	});
});
