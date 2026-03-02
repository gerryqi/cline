import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const cliRoot = path.resolve(__dirname, "..");
const cliEntry = path.join(cliRoot, "src", "index.ts");
const bunExec = process.env.BUN_EXEC_PATH ?? "bun";

type CliResult = ReturnType<typeof spawnSync>;

function asText(value: string | Buffer): string {
	return typeof value === "string" ? value : value.toString("utf8");
}

function runCli(
	args: string[],
	options?: {
		cwd?: string;
		env?: NodeJS.ProcessEnv;
		stdin?: string;
	},
): CliResult {
	return spawnSync(bunExec, [cliEntry, ...args], {
		cwd: options?.cwd ?? cliRoot,
		encoding: "utf8",
		input: options?.stdin,
		env: options?.env,
	});
}

describe("cli e2e", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("prints help output", () => {
		const result = runCli(["--help"], { env: process.env });
		expect(result.status).toBe(0);
		expect(asText(result.stderr)).toBe("");
		expect(asText(result.stdout)).toContain("USAGE");
		expect(asText(result.stdout)).toContain("--tool-require-approval");
	});

	it("prints version output", () => {
		const result = runCli(["--version"], { env: process.env });
		expect(result.status).toBe(0);
		expect(asText(result.stdout).trim()).toBe("0.1.0");
	});

	it("lists sessions from isolated storage", () => {
		const homeDir = mkdtempSync(path.join(os.tmpdir(), "cli-e2e-home-"));
		const sessionDir = mkdtempSync(path.join(os.tmpdir(), "cli-e2e-sessions-"));
		tempDirs.push(homeDir, sessionDir);
		const result = runCli(["sessions", "list", "--limit", "25"], {
			env: {
				...process.env,
				HOME: homeDir,
				CLINE_SESSION_DATA_DIR: sessionDir,
			},
		});

		expect(result.status).toBe(0);
		const parsed = JSON.parse(asText(result.stdout)) as unknown;
		expect(Array.isArray(parsed)).toBe(true);
	});

	it("returns an error when deleting a session without --session-id", () => {
		const result = runCli(["sessions", "delete"], { env: process.env });
		expect(result.status).toBe(1);
		expect(asText(result.stderr)).toContain(
			"sessions delete requires --session-id <id>",
		);
	});

	it("rejects invalid hook payloads", () => {
		const result = runCli(["hook"], {
			env: process.env,
			stdin: JSON.stringify({ bad: "payload" }),
		});
		expect(result.status).toBe(1);
		expect(asText(result.stderr)).toContain("invalid hook payload");
	});

	it("accepts valid hook payloads and writes audit log", () => {
		const homeDir = mkdtempSync(path.join(os.tmpdir(), "cli-e2e-home-"));
		const sessionDir = mkdtempSync(path.join(os.tmpdir(), "cli-e2e-sessions-"));
		const logDir = mkdtempSync(path.join(os.tmpdir(), "cli-e2e-hooks-"));
		tempDirs.push(homeDir, sessionDir, logDir);
		const hookPath = path.join(logDir, "hook-events.jsonl");
		const result = runCli(["hook"], {
			env: {
				...process.env,
				HOME: homeDir,
				CLINE_SESSION_DATA_DIR: sessionDir,
				CLINE_HOOKS_LOG_PATH: hookPath,
			},
			stdin: JSON.stringify({
				hook_event_name: "tool_call",
				agent_id: "agent_1",
				conversation_id: "conversation_1",
				parent_agent_id: null,
				tool_call: {
					name: "read_files",
					input: { file_paths: ["README.md"] },
				},
			}),
		});

		expect(result.status).toBe(0);
		expect(asText(result.stdout).trim()).toBe("{}");
		const log = readFileSync(hookPath, "utf8");
		expect(log).toContain('"hook_event_name":"tool_call"');
		expect(log).toContain('"agent_id":"agent_1"');
	});
});
