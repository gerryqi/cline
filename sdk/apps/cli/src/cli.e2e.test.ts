import { spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const cliRoot = path.resolve(__dirname, "..");
const cliEntry = path.join(cliRoot, "src", "index.ts");
const cliPackage = JSON.parse(
	readFileSync(path.join(cliRoot, "package.json"), "utf8"),
) as { version: string };
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
		expect(asText(result.stdout)).toContain("--output <text|json>");
		expect(asText(result.stdout)).toContain("--sandbox");
		expect(asText(result.stdout)).toContain("--thinking");
		expect(asText(result.stdout)).toContain(
			"clite list <workflows|rules|skills|agents|history|hooks|mcp>",
		);
	});

	it("prints version output", () => {
		const result = runCli(["--version"], { env: process.env });
		expect(result.status).toBe(0);
		expect(asText(result.stdout).trim()).toBe(cliPackage.version);
	});

	it("rejects unsupported output modes", () => {
		const result = runCli(["--output", "xml", "hello"], { env: process.env });
		expect(result.status).toBe(1);
		expect(asText(result.stderr)).toContain("invalid output mode");
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

	it("lists history items from isolated storage", () => {
		const homeDir = mkdtempSync(path.join(os.tmpdir(), "cli-e2e-home-"));
		const sessionDir = mkdtempSync(path.join(os.tmpdir(), "cli-e2e-sessions-"));
		tempDirs.push(homeDir, sessionDir);
		const result = runCli(["list", "history", "--limit", "25"], {
			env: {
				...process.env,
				HOME: homeDir,
				CLINE_SESSION_DATA_DIR: sessionDir,
			},
		});

		expect(result.status).toBe(0);
		const lines = asText(result.stdout)
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.length > 0);
		for (const line of lines) {
			expect(line).toMatch(/^.+ - .+ - .+ - .+$/);
		}
	});

	it("returns an error when deleting a session without --session-id", () => {
		const result = runCli(["sessions", "delete"], { env: process.env });
		expect(result.status).toBe(1);
		expect(asText(result.stderr)).toContain(
			"sessions delete requires --session-id <id>",
		);
	});

	it("returns an error when session flag is provided without an id", () => {
		const result = runCli(["--session"], { env: process.env });
		expect(result.status).toBe(1);
		expect(asText(result.stderr)).toContain("--session requires <id>");
	});

	it("lists enabled workflows in text mode", () => {
		const workspace = mkdtempSync(path.join(os.tmpdir(), "cli-e2e-workflows-"));
		tempDirs.push(workspace);
		const workflowsDir = path.join(workspace, ".clinerules", "workflows");
		mkdirSync(workflowsDir, { recursive: true });
		writeFileSync(
			path.join(workflowsDir, "release.md"),
			`---
name: release
---
Release checklist.`,
			"utf8",
		);
		writeFileSync(
			path.join(workflowsDir, "disabled.md"),
			`---
name: disabled
disabled: true
---
Do not list this.`,
			"utf8",
		);

		const result = runCli(["list", "workflows"], {
			cwd: workspace,
			env: process.env,
		});
		expect(result.status).toBe(0);
		expect(asText(result.stdout)).toContain("Available workflows:");
		expect(asText(result.stdout)).toContain("/release");
		expect(asText(result.stdout)).toContain(
			path.join(workflowsDir, "release.md"),
		);
		expect(asText(result.stdout)).not.toContain("/disabled");
	});

	it("lists workflows from workspace root when run in a subdirectory", () => {
		const workspace = mkdtempSync(path.join(os.tmpdir(), "cli-e2e-workflows-"));
		tempDirs.push(workspace);
		const workflowsDir = path.join(workspace, ".clinerules", "workflows");
		const nestedDir = path.join(workspace, "packages", "app");
		mkdirSync(workflowsDir, { recursive: true });
		mkdirSync(nestedDir, { recursive: true });
		writeFileSync(
			path.join(workflowsDir, "release.md"),
			`---
name: release
---
Release checklist.`,
			"utf8",
		);
		spawnSync("git", ["init"], {
			cwd: workspace,
			encoding: "utf8",
		});

		const result = runCli(["list", "workflows"], {
			cwd: nestedDir,
			env: process.env,
		});
		expect(result.status).toBe(0);
		expect(asText(result.stdout)).toContain("/release");
	});

	it("lists enabled workflows in json mode", () => {
		const workspace = mkdtempSync(path.join(os.tmpdir(), "cli-e2e-workflows-"));
		tempDirs.push(workspace);
		const workflowsDir = path.join(workspace, ".clinerules", "workflows");
		mkdirSync(workflowsDir, { recursive: true });
		writeFileSync(
			path.join(workflowsDir, "review.md"),
			`---
name: review
---
Review checklist.`,
			"utf8",
		);

		const result = runCli(["list", "workflows", "--json"], {
			cwd: workspace,
			env: process.env,
		});
		expect(result.status).toBe(0);
		const parsed = JSON.parse(asText(result.stdout)) as Array<{
			name: string;
		}>;
		expect(parsed.some((workflow) => workflow.name === "review")).toBe(true);
	});

	it("includes Documents/Cline workflows", () => {
		const homeDir = mkdtempSync(path.join(os.tmpdir(), "cli-e2e-home-"));
		const workspace = mkdtempSync(path.join(os.tmpdir(), "cli-e2e-workspace-"));
		tempDirs.push(homeDir, workspace);
		const docsWorkflowsDir = path.join(
			homeDir,
			"Documents",
			"Cline",
			"Workflows",
		);
		mkdirSync(docsWorkflowsDir, { recursive: true });
		writeFileSync(
			path.join(docsWorkflowsDir, "docs-release.md"),
			`---
name: docs-release
---
Release from docs path.`,
			"utf8",
		);

		const result = runCli(["list", "workflows"], {
			cwd: workspace,
			env: {
				...process.env,
				HOME: homeDir,
			},
		});
		expect(result.status).toBe(0);
		expect(asText(result.stdout)).toContain("/docs-release");
	});

	it("lists enabled rules", () => {
		const workspace = mkdtempSync(path.join(os.tmpdir(), "cli-e2e-rules-"));
		tempDirs.push(workspace);
		const rulesDir = path.join(workspace, ".clinerules");
		mkdirSync(rulesDir, { recursive: true });
		writeFileSync(
			path.join(rulesDir, "rule.md"),
			`---
name: no-force-push
---
Do not force push.`,
			"utf8",
		);

		const result = runCli(["list", "rules"], {
			cwd: workspace,
			env: process.env,
		});
		expect(result.status).toBe(0);
		expect(asText(result.stdout)).toContain("Enabled rules:");
		expect(asText(result.stdout)).toContain("no-force-push");
		expect(asText(result.stdout)).toContain(path.join(rulesDir, "rule.md"));
	});

	it("lists enabled skills", () => {
		const workspace = mkdtempSync(path.join(os.tmpdir(), "cli-e2e-skills-"));
		tempDirs.push(workspace);
		const skillsDir = path.join(workspace, ".clinerules", "skills", "commit");
		mkdirSync(skillsDir, { recursive: true });
		writeFileSync(
			path.join(skillsDir, "SKILL.md"),
			`---
name: commit
---
Create a concise commit message.`,
			"utf8",
		);

		const result = runCli(["list", "skills"], {
			cwd: workspace,
			env: process.env,
		});
		expect(result.status).toBe(0);
		expect(asText(result.stdout)).toContain("Enabled skills:");
		expect(asText(result.stdout)).toContain("commit");
		expect(asText(result.stdout)).toContain(path.join(skillsDir, "SKILL.md"));
	});

	it("includes Documents/Cline rules and skills", () => {
		const homeDir = mkdtempSync(path.join(os.tmpdir(), "cli-e2e-home-"));
		const workspace = mkdtempSync(path.join(os.tmpdir(), "cli-e2e-workspace-"));
		tempDirs.push(homeDir, workspace);
		const docsRulesDir = path.join(homeDir, "Documents", "Cline", "Rules");
		const docsSkillsDir = path.join(
			homeDir,
			"Documents",
			"Cline",
			"Skills",
			"review",
		);
		mkdirSync(docsRulesDir, { recursive: true });
		mkdirSync(docsSkillsDir, { recursive: true });
		writeFileSync(
			path.join(docsRulesDir, "docs-rule.md"),
			`---
name: docs-rule
---
Rule from docs path.`,
			"utf8",
		);
		writeFileSync(
			path.join(docsSkillsDir, "SKILL.md"),
			`---
name: docs-skill
---
Skill from docs path.`,
			"utf8",
		);

		const rulesResult = runCli(["list", "rules"], {
			cwd: workspace,
			env: {
				...process.env,
				HOME: homeDir,
			},
		});
		expect(rulesResult.status).toBe(0);
		expect(asText(rulesResult.stdout)).toContain("docs-rule");

		const skillsResult = runCli(["list", "skills"], {
			cwd: workspace,
			env: {
				...process.env,
				HOME: homeDir,
			},
		});
		expect(skillsResult.status).toBe(0);
		expect(asText(skillsResult.stdout)).toContain("docs-skill");
	});

	it("lists configured agents with source paths", () => {
		const homeDir = mkdtempSync(path.join(os.tmpdir(), "cli-e2e-home-"));
		const dataDir = mkdtempSync(path.join(os.tmpdir(), "cli-e2e-data-"));
		const workspace = mkdtempSync(path.join(os.tmpdir(), "cli-e2e-workspace-"));
		tempDirs.push(homeDir, dataDir, workspace);
		const docsAgentsDir = path.join(homeDir, "Documents", "Cline", "Agents");
		const settingsAgentsDir = path.join(dataDir, "settings", "agents");
		mkdirSync(docsAgentsDir, { recursive: true });
		mkdirSync(settingsAgentsDir, { recursive: true });
		writeFileSync(
			path.join(docsAgentsDir, "reviewer.yaml"),
			`---
name: Reviewer
description: Reviews code changes
---
Review diffs thoroughly.`,
			"utf8",
		);
		writeFileSync(
			path.join(settingsAgentsDir, "planner.yaml"),
			`---
name: Planner
description: Plans implementation tasks
---
Break work into clear steps.`,
			"utf8",
		);

		const textResult = runCli(["list", "agents"], {
			cwd: workspace,
			env: {
				...process.env,
				HOME: homeDir,
				CLINE_DATA_DIR: dataDir,
			},
		});
		expect(textResult.status).toBe(0);
		expect(asText(textResult.stdout)).toContain("Configured agents:");
		expect(asText(textResult.stdout)).toContain("Reviewer");
		expect(asText(textResult.stdout)).toContain("Planner");
		expect(asText(textResult.stdout)).toContain(
			path.join(docsAgentsDir, "reviewer.yaml"),
		);
		expect(asText(textResult.stdout)).toContain(
			path.join(settingsAgentsDir, "planner.yaml"),
		);

		const jsonResult = runCli(["list", "agents", "--json"], {
			cwd: workspace,
			env: {
				...process.env,
				HOME: homeDir,
				CLINE_DATA_DIR: dataDir,
			},
		});
		expect(jsonResult.status).toBe(0);
		const parsed = JSON.parse(asText(jsonResult.stdout)) as Array<{
			name: string;
			path: string;
		}>;
		expect(parsed.some((agent) => agent.name === "Reviewer")).toBe(true);
		expect(parsed.some((agent) => agent.name === "Planner")).toBe(true);
		expect(
			parsed.some(
				(agent) => agent.path === path.join(docsAgentsDir, "reviewer.yaml"),
			),
		).toBe(true);
	});

	it("lists configured mcp servers", () => {
		const tempRoot = mkdtempSync(path.join(os.tmpdir(), "cli-e2e-mcp-"));
		tempDirs.push(tempRoot);
		const settingsPath = path.join(tempRoot, "cline_mcp_settings.json");
		writeFileSync(
			settingsPath,
			JSON.stringify(
				{
					mcpServers: {
						docs: {
							transport: {
								type: "stdio",
								command: "node",
							},
						},
						remote: {
							transport: {
								type: "streamableHttp",
								url: "https://mcp.example.com",
							},
							disabled: true,
						},
					},
				},
				null,
				2,
			),
			"utf8",
		);

		const textResult = runCli(["list", "mcp"], {
			env: {
				...process.env,
				CLINE_MCP_SETTINGS_PATH: settingsPath,
			},
		});
		expect(textResult.status).toBe(0);
		expect(asText(textResult.stdout)).toContain("Configured MCP servers");
		expect(asText(textResult.stdout)).toContain("docs [stdio]");
		expect(asText(textResult.stdout)).toContain(
			"remote [streamableHttp] (disabled)",
		);

		const jsonResult = runCli(["list", "mcp", "--json"], {
			env: {
				...process.env,
				CLINE_MCP_SETTINGS_PATH: settingsPath,
			},
		});
		expect(jsonResult.status).toBe(0);
		const parsed = JSON.parse(asText(jsonResult.stdout)) as Array<{
			name: string;
			transportType: string;
			disabled: boolean;
			path: string;
		}>;
		expect(parsed.some((server) => server.name === "docs")).toBe(true);
		expect(parsed.some((server) => server.name === "remote")).toBe(true);
		expect(
			parsed.some(
				(server) =>
					server.name === "remote" &&
					server.transportType === "streamableHttp" &&
					server.disabled === true &&
					server.path === settingsPath,
			),
		).toBe(true);
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
				hookName: "tool_call",
				taskId: "conversation_1",
				clineVersion: "",
				timestamp: new Date().toISOString(),
				workspaceRoots: [],
				userId: "agent_1",
				agent_id: "agent_1",
				parent_agent_id: null,
				tool_call: {
					id: "call_1",
					name: "read_files",
					input: { file_paths: ["README.md"] },
				},
			}),
		});

		expect(result.status).toBe(0);
		expect(asText(result.stdout).trim()).toBe("{}");
		const log = readFileSync(hookPath, "utf8");
		expect(log).toContain('"hookName":"tool_call"');
		expect(log).toContain('"agent_id":"agent_1"');
	});
});
