import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createCliLoggerAdapter } from "./adapter";

const envKeys = [
	"CLINE_DATA_DIR",
	"CLINE_LOG_PATH",
	"CLINE_LOG_LEVEL",
	"CLINE_LOG_NAME",
	"CLINE_LOG_ENABLED",
] as const;

function withEnvSnapshot(): Record<
	(typeof envKeys)[number],
	string | undefined
> {
	return {
		CLINE_DATA_DIR: process.env.CLINE_DATA_DIR,
		CLINE_LOG_PATH: process.env.CLINE_LOG_PATH,
		CLINE_LOG_LEVEL: process.env.CLINE_LOG_LEVEL,
		CLINE_LOG_NAME: process.env.CLINE_LOG_NAME,
		CLINE_LOG_ENABLED: process.env.CLINE_LOG_ENABLED,
	};
}

function restoreEnv(
	snapshot: Record<(typeof envKeys)[number], string | undefined>,
): void {
	for (const key of envKeys) {
		const value = snapshot[key];
		if (value === undefined) {
			delete process.env[key];
			continue;
		}
		process.env[key] = value;
	}
}

describe("createCliLoggerAdapter", () => {
	it("resolves default runtime config from data dir", () => {
		const snapshot = withEnvSnapshot();
		const dataDir = mkdtempSync(join(tmpdir(), "clite-log-test-"));
		process.env.CLINE_DATA_DIR = dataDir;
		delete process.env.CLINE_LOG_PATH;
		delete process.env.CLINE_LOG_LEVEL;
		delete process.env.CLINE_LOG_NAME;
		delete process.env.CLINE_LOG_ENABLED;

		try {
			const adapter = createCliLoggerAdapter({ runtime: "cli" });
			expect(adapter.runtimeConfig.destination).toBe(
				join(dataDir, "logs", "clite.log"),
			);
			expect(adapter.runtimeConfig.level).toBe("info");
			expect(adapter.runtimeConfig.name).toBe("clite.cli");
			expect(adapter.runtimeConfig.enabled).toBe(true);
		} finally {
			restoreEnv(snapshot);
		}
	});

	it("uses provided runtime config in rpc runtime", () => {
		const adapter = createCliLoggerAdapter({
			runtime: "rpc-runtime",
			runtimeConfig: {
				destination: "/tmp/custom-runtime.log",
				level: "warn",
				name: "custom-runtime",
				enabled: false,
			},
		});

		expect(adapter.runtimeConfig.destination).toBe("/tmp/custom-runtime.log");
		expect(adapter.runtimeConfig.level).toBe("warn");
		expect(adapter.runtimeConfig.name).toBe("custom-runtime");
		expect(adapter.runtimeConfig.enabled).toBe(false);
	});

	it("maps core logger metadata with error payload", () => {
		const dataDir = mkdtempSync(join(tmpdir(), "clite-log-test-"));
		const snapshot = withEnvSnapshot();
		process.env.CLINE_DATA_DIR = dataDir;
		process.env.CLINE_LOG_ENABLED = "0";
		try {
			const adapter = createCliLoggerAdapter({ runtime: "cli" });
			expect(() => {
				adapter.core.error?.("runtime error", {
					error: new Error("boom"),
					sessionId: "s1",
				});
			}).not.toThrow();
		} finally {
			restoreEnv(snapshot);
		}
	});
});
