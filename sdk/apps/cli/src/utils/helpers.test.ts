import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	appendHookAudit,
	configureSandboxEnvironment,
	formatToolInput,
	formatToolOutput,
	isCliHookPayload,
	parseArgs,
} from "./helpers";

type EnvSnapshot = {
	CLINE_DATA_DIR: string | undefined;
	CLINE_HOOKS_LOG_PATH: string | undefined;
	CLINE_SESSION_ID: string | undefined;
	CLINE_SESSION_DATA_DIR: string | undefined;
};

function captureEnv(): EnvSnapshot {
	return {
		CLINE_DATA_DIR: process.env.CLINE_DATA_DIR,
		CLINE_HOOKS_LOG_PATH: process.env.CLINE_HOOKS_LOG_PATH,
		CLINE_SESSION_ID: process.env.CLINE_SESSION_ID,
		CLINE_SESSION_DATA_DIR: process.env.CLINE_SESSION_DATA_DIR,
	};
}

function restoreEnv(snapshot: EnvSnapshot): void {
	process.env.CLINE_DATA_DIR = snapshot.CLINE_DATA_DIR;
	process.env.CLINE_HOOKS_LOG_PATH = snapshot.CLINE_HOOKS_LOG_PATH;
	process.env.CLINE_SESSION_ID = snapshot.CLINE_SESSION_ID;
	process.env.CLINE_SESSION_DATA_DIR = snapshot.CLINE_SESSION_DATA_DIR;
}

describe("parseArgs", () => {
	it("returns defaults when no arguments are supplied", () => {
		const parsed = parseArgs([]);
		expect(parsed).toEqual({
			interactive: false,
			showHelp: false,
			showVersion: false,
			showUsage: false,
			showTimings: false,
			outputMode: "text",
			mode: "act",
			sandbox: false,
			thinking: false,
			enableSpawnAgent: true,
			enableAgentTeams: true,
			enableTools: true,
			defaultToolAutoApprove: true,
			toolPolicies: {},
		});
	});

	it("parses prompt, runtime flags, and per-tool approval settings", () => {
		const parsed = parseArgs([
			"--no-tools",
			"--no-spawn",
			"--no-teams",
			"--require-tool-approval",
			"--tool-enable",
			"read_files",
			"--tool-require-approval",
			"read_files",
			"--tool-autoapprove",
			"run_commands",
			"--cwd",
			"/tmp/work",
			"--team-name",
			"dev-team",
			"--mission-step-interval",
			"4",
			"--mission-time-interval-ms",
			"25000",
			"--provider",
			"openai",
			"--model",
			"gpt-5",
			"--key",
			"abc123",
			"--usage",
			"--timings",
			"--thinking",
			"--mode",
			"plan",
			"Audit",
			"the",
			"repo",
		]);

		expect(parsed.prompt).toBe("Audit the repo");
		expect(parsed.enableTools).toBe(false);
		expect(parsed.enableSpawnAgent).toBe(false);
		expect(parsed.enableAgentTeams).toBe(false);
		expect(parsed.defaultToolAutoApprove).toBe(false);
		expect(parsed.showUsage).toBe(true);
		expect(parsed.showTimings).toBe(true);
		expect(parsed.thinking).toBe(true);
		expect(parsed.outputMode).toBe("text");
		expect(parsed.mode).toBe("plan");
		expect(parsed.cwd).toBe("/tmp/work");
		expect(parsed.teamName).toBe("dev-team");
		expect(parsed.missionLogIntervalSteps).toBe(4);
		expect(parsed.missionLogIntervalMs).toBe(25000);
		expect(parsed.provider).toBe("openai");
		expect(parsed.model).toBe("gpt-5");
		expect(parsed.key).toBe("abc123");
		expect(parsed.sandbox).toBe(false);
		expect(parsed.toolPolicies).toEqual({
			read_files: { enabled: true, autoApprove: false },
			run_commands: { autoApprove: true },
		});
	});

	it("parses sandbox flags", () => {
		const parsed = parseArgs(["--sandbox", "--sandbox-dir", "./.tmp-cline"]);
		expect(parsed.sandbox).toBe(true);
		expect(parsed.sandboxDir).toBe("./.tmp-cline");
	});

	it("ignores empty tool names for tool-policy flags", () => {
		const parsed = parseArgs([
			"--tool-enable",
			"",
			"--tool-disable",
			"",
			"--tool-autoapprove",
			"",
			"--tool-require-approval",
			"",
		]);
		expect(parsed.toolPolicies).toEqual({});
	});

	it("supports json output flags and validates explicit output modes", () => {
		const parsedJsonAlias = parseArgs(["--json", "hello"]);
		expect(parsedJsonAlias.outputMode).toBe("json");
		expect(parsedJsonAlias.prompt).toBe("hello");

		const parsedJsonValue = parseArgs(["--output", "json"]);
		expect(parsedJsonValue.outputMode).toBe("json");

		const parsedInvalid = parseArgs(["--output", "xml"]);
		expect(parsedInvalid.outputMode).toBe("text");
		expect(parsedInvalid.invalidOutputMode).toBe("xml");
	});

	it("parses and validates agent mode", () => {
		const parsedPlan = parseArgs(["--mode", "plan"]);
		expect(parsedPlan.mode).toBe("plan");

		const parsedInvalid = parseArgs(["--mode", "build"]);
		expect(parsedInvalid.mode).toBe("act");
		expect(parsedInvalid.invalidMode).toBe("build");
	});

	it("parses session resume flag", () => {
		const parsed = parseArgs(["--session", "session_123"]);
		expect(parsed.sessionId).toBe("session_123");
	});
});

describe("format helpers", () => {
	it("formats known tool input payloads with truncation", () => {
		expect(
			formatToolInput("run_commands", {
				commands: [
					"echo hello",
					"npm run very-very-long-command-name-that-will-truncate",
				],
			}),
		).toContain("echo hello");
		expect(
			formatToolInput("team_run_task", {
				runMode: "sync",
				agentId: "coder",
				task: "implement feature with extensive acceptance criteria and checks",
			}),
		).toContain("sync coder:");
		expect(
			formatToolInput("team_member", {
				action: "spawn",
				agentId: "reviewer",
				rolePrompt: "Review changes and call out risks",
			}),
		).toContain("spawn reviewer:");
		expect(
			formatToolInput("team_task", {
				action: "complete",
				taskId: "task_0012",
				summary: "Done and verified",
			}),
		).toContain("complete task_0012:");
		expect(
			formatToolInput("team_message", {
				action: "send",
				toAgentId: "lead",
				subject: "Status update",
			}),
		).toContain("send lead:");
	});

	it("summarizes structured tool outputs", () => {
		expect(formatToolOutput("simple text output")).toBe("simple text output");
		expect(
			formatToolOutput([
				{ result: "first" },
				{ result: "second" },
				{ result: "third" },
			]),
		).toBe("first (+2 more)");
		expect(formatToolOutput(null)).toBe("");
	});
});

describe("hook payload validation and audit logging", () => {
	let tempDir = "";

	afterEach(() => {
		if (tempDir) {
			rmSync(tempDir, { recursive: true, force: true });
			tempDir = "";
		}
	});

	it("validates hook payload structure", () => {
		expect(
			isCliHookPayload({
				clineVersion: "",
				hookName: "tool_call",
				timestamp: new Date().toISOString(),
				taskId: "conv_1",
				workspaceRoots: [],
				userId: "agent_1",
				agent_id: "agent_1",
				parent_agent_id: null,
				iteration: 1,
				tool_call: {
					id: "call_1",
					name: "read_files",
					input: { file_paths: ["README.md"] },
				},
			}),
		).toBe(true);
		expect(isCliHookPayload({ hookName: "tool_call" })).toBe(false);
		expect(isCliHookPayload(null)).toBe(false);
	});

	it("writes hook audits to explicit hook path when configured", () => {
		tempDir = mkdtempSync(path.join(os.tmpdir(), "cli-helper-audit-"));
		const hookPath = path.join(tempDir, "explicit", "hooks.jsonl");
		const env = captureEnv();
		process.env.CLINE_HOOKS_LOG_PATH = hookPath;
		process.env.CLINE_SESSION_ID = "session_from_env";
		process.env.CLINE_SESSION_DATA_DIR = path.join(tempDir, "sessions");

		try {
			appendHookAudit({
				clineVersion: "",
				hookName: "tool_call",
				timestamp: new Date().toISOString(),
				taskId: "conv_1",
				workspaceRoots: [],
				userId: "agent_1",
				iteration: 1,
				agent_id: "agent_1",
				parent_agent_id: null,
				tool_call: {
					id: "call_1",
					name: "read_files",
					input: { file_paths: ["README.md"] },
				},
			});
		} finally {
			restoreEnv(env);
		}

		expect(existsSync(hookPath)).toBe(true);
		const content = readFileSync(hookPath, "utf8");
		expect(content).toContain('"hookName":"tool_call"');
		expect(content).toContain('"agent_id":"agent_1"');
	});

	it("falls back to session-derived hook path when session id is set", () => {
		tempDir = mkdtempSync(path.join(os.tmpdir(), "cli-helper-session-audit-"));
		const sessionId = "session_abc";
		const expectedPath = path.join(
			tempDir,
			sessionId,
			`${sessionId}.hooks.jsonl`,
		);
		const env = captureEnv();
		delete process.env.CLINE_HOOKS_LOG_PATH;
		process.env.CLINE_SESSION_ID = sessionId;
		process.env.CLINE_SESSION_DATA_DIR = tempDir;

		try {
			appendHookAudit({
				clineVersion: "",
				hookName: "tool_result",
				timestamp: new Date().toISOString(),
				taskId: "conv_2",
				workspaceRoots: [],
				userId: "agent_2",
				iteration: 1,
				agent_id: "agent_2",
				parent_agent_id: null,
				tool_result: {
					id: "call_2",
					name: "read_files",
					input: { file_paths: ["README.md"] },
					output: "ok",
					durationMs: 5,
					startedAt: new Date("2026-01-01T00:00:00.000Z"),
					endedAt: new Date("2026-01-01T00:00:00.005Z"),
				},
			});
		} finally {
			restoreEnv(env);
		}

		expect(existsSync(expectedPath)).toBe(true);
		const content = readFileSync(expectedPath, "utf8");
		expect(content).toContain('"hookName":"tool_result"');
	});
});

describe("sandbox environment", () => {
	it("sets sandbox-specific storage paths", () => {
		const root = mkdtempSync(path.join(os.tmpdir(), "cli-helper-sandbox-"));
		const previous = {
			CLINE_SANDBOX: process.env.CLINE_SANDBOX,
			CLINE_SANDBOX_DATA_DIR: process.env.CLINE_SANDBOX_DATA_DIR,
			CLINE_DATA_DIR: process.env.CLINE_DATA_DIR,
			CLINE_SESSION_DATA_DIR: process.env.CLINE_SESSION_DATA_DIR,
			CLINE_TEAM_DATA_DIR: process.env.CLINE_TEAM_DATA_DIR,
			CLINE_PROVIDER_SETTINGS_PATH: process.env.CLINE_PROVIDER_SETTINGS_PATH,
			CLINE_HOOKS_LOG_PATH: process.env.CLINE_HOOKS_LOG_PATH,
		};
		try {
			const resolved = configureSandboxEnvironment({
				enabled: true,
				cwd: root,
				explicitDir: "./sandbox-state",
			});
			expect(resolved).toBe(path.join(root, "sandbox-state"));
			expect(process.env.CLINE_SANDBOX).toBe("1");
			expect(process.env.CLINE_SANDBOX_DATA_DIR).toBe(
				path.join(root, "sandbox-state"),
			);
			expect(process.env.CLINE_DATA_DIR).toBe(path.join(root, "sandbox-state"));
			expect(process.env.CLINE_SESSION_DATA_DIR).toBe(
				path.join(root, "sandbox-state", "sessions"),
			);
			expect(process.env.CLINE_TEAM_DATA_DIR).toBe(
				path.join(root, "sandbox-state", "teams"),
			);
			expect(process.env.CLINE_PROVIDER_SETTINGS_PATH).toBe(
				path.join(root, "sandbox-state", "settings", "providers.json"),
			);
			expect(process.env.CLINE_HOOKS_LOG_PATH).toBe(
				path.join(root, "sandbox-state", "hooks", "hooks.jsonl"),
			);
		} finally {
			process.env.CLINE_SANDBOX = previous.CLINE_SANDBOX;
			process.env.CLINE_SANDBOX_DATA_DIR = previous.CLINE_SANDBOX_DATA_DIR;
			process.env.CLINE_DATA_DIR = previous.CLINE_DATA_DIR;
			process.env.CLINE_SESSION_DATA_DIR = previous.CLINE_SESSION_DATA_DIR;
			process.env.CLINE_TEAM_DATA_DIR = previous.CLINE_TEAM_DATA_DIR;
			process.env.CLINE_PROVIDER_SETTINGS_PATH =
				previous.CLINE_PROVIDER_SETTINGS_PATH;
			process.env.CLINE_HOOKS_LOG_PATH = previous.CLINE_HOOKS_LOG_PATH;
			rmSync(root, { recursive: true, force: true });
		}
	});
});
