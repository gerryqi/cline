import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { type HookEventPayload, parseHookEventPayload } from "@cline/agents";
import { resolveHookLogPath } from "@cline/shared";
import { nanoid } from "nanoid";
import type { ParsedArgs } from "./types";

export function sanitizeSessionToken(value: string): string {
	return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

export function makeSubSessionId(
	rootSessionId: string,
	agentId: string,
): string {
	const root = sanitizeSessionToken(rootSessionId);
	const agent = sanitizeSessionToken(agentId);
	const joined = `${root}__${agent}`;
	return joined.length > 180 ? joined.slice(0, 180) : joined;
}

export function makeTeamTaskSubSessionId(
	rootSessionId: string,
	agentId: string,
): string {
	const root = sanitizeSessionToken(rootSessionId);
	const agent = sanitizeSessionToken(agentId);
	const nonce = Math.random().toString(36).slice(2, 8);
	return `${root}__teamtask__${agent}__${Date.now()}_${nonce}`;
}

export function nowIso(): string {
	return new Date().toISOString();
}

export function randomSessionId(): string {
	return `${Date.now()}_${nanoid(5)}_cli`;
}

export function resolveWorkspaceRoot(cwd: string): string {
	const result = spawnSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
		encoding: "utf8",
	});
	if (result.status === 0) {
		const value = result.stdout.trim();
		if (value) {
			return value;
		}
	}
	return cwd;
}

export function truncate(str: string, maxLen: number): string {
	const oneLine = str.replace(/\n/g, " ").trim();
	if (oneLine.length <= maxLen) {
		return oneLine;
	}
	return `${oneLine.slice(0, maxLen - 3)}...`;
}

export function formatToolInput(toolName: string, input: unknown): string {
	if (!input || typeof input !== "object") {
		return "";
	}

	const obj = input as Record<string, unknown>;

	switch (toolName) {
		case "run_commands":
			if (Array.isArray(obj.commands)) {
				return obj.commands.map((cmd) => truncate(String(cmd), 60)).join("; ");
			}
			break;
		case "read_files":
			if (Array.isArray(obj.file_paths)) {
				return obj.file_paths.map((p) => truncate(String(p), 40)).join(", ");
			}
			break;
		case "search_codebase":
			if (Array.isArray(obj.queries)) {
				return obj.queries.map((q) => truncate(String(q), 40)).join(", ");
			}
			break;
		case "fetch_web_content":
			if (Array.isArray(obj.requests)) {
				return obj.requests
					.map((r: { url?: string }) => truncate(String(r.url ?? ""), 40))
					.join(", ");
			}
			break;
		case "spawn_agent":
			return truncate(String(obj.task ?? ""), 50);
		case "skills":
			return truncate(
				`${String(obj.skill ?? "")}${obj.args ? ` ${String(obj.args)}` : ""}`,
				70,
			);
		case "ask_followup_question":
			return truncate(String(obj.question ?? ""), 70);
		case "team_member": {
			const action = String(obj.action ?? "");
			if (action === "spawn") {
				return truncate(
					`spawn ${String(obj.agentId ?? "")}: ${String(obj.rolePrompt ?? "")}`,
					70,
				);
			}
			if (action === "shutdown") {
				return truncate(`shutdown ${String(obj.agentId ?? "")}`, 70);
			}
			break;
		}
		case "team_spawn_teammate":
			return truncate(
				`${String(obj.agentId ?? "")}: ${String(obj.rolePrompt ?? "")}`,
				70,
			);
		case "team_task": {
			const action = String(obj.action ?? "");
			if (action === "create") {
				return truncate(`create ${String(obj.title ?? "")}`, 60);
			}
			if (action === "claim") {
				return truncate(`claim ${String(obj.taskId ?? "")}`, 60);
			}
			if (action === "complete") {
				return truncate(
					`complete ${String(obj.taskId ?? "")}: ${String(obj.summary ?? "")}`,
					70,
				);
			}
			if (action === "block") {
				return truncate(
					`block ${String(obj.taskId ?? "")}: ${String(obj.reason ?? "")}`,
					70,
				);
			}
			break;
		}
		case "team_create_task":
			return truncate(`create ${String(obj.title ?? "")}`, 60);
		case "team_claim_task":
			return truncate(`claim ${String(obj.taskId ?? "")}`, 60);
		case "team_complete_task":
			return truncate(
				`complete ${String(obj.taskId ?? "")}: ${String(obj.summary ?? "")}`,
				70,
			);
		case "team_block_task":
			return truncate(
				`block ${String(obj.taskId ?? "")}: ${String(obj.reason ?? "")}`,
				70,
			);
		case "team_run_task":
			return truncate(
				`${String(obj.runMode ?? "sync")} ${String(obj.agentId ?? "")}: ${String(obj.task ?? "")}`,
				70,
			);
		case "team_list_runs":
			return truncate(
				`status=${String(obj.status ?? "any")} agent=${String(obj.agentId ?? "any")}`,
				60,
			);
		case "team_await_run":
			return truncate(
				String(obj.awaitAll ? "all runs" : (obj.runId ?? "")),
				60,
			);
		case "team_message": {
			const action = String(obj.action ?? "");
			if (action === "send") {
				return truncate(
					`send ${String(obj.toAgentId ?? "")}: ${String(obj.subject ?? "")}`,
					70,
				);
			}
			if (action === "broadcast") {
				return truncate(`broadcast ${String(obj.subject ?? "")}`, 70);
			}
			if (action === "read") {
				return truncate(
					`read unreadOnly=${String(obj.unreadOnly ?? true)} limit=${String(obj.limit ?? "default")}`,
					70,
				);
			}
			break;
		}
		case "team_send_message":
			return truncate(
				`${String(obj.toAgentId ?? "")}: ${String(obj.subject ?? "")}`,
				70,
			);
		case "team_broadcast":
			return truncate(String(obj.subject ?? ""), 70);
	}

	return truncate(JSON.stringify(input), 60);
}

export function formatToolOutput(output: unknown): string {
	if (output === null || output === undefined) {
		return "";
	}

	if (typeof output === "string") {
		return truncate(output, 100);
	}

	if (Array.isArray(output)) {
		const results = output
			.map((item) => {
				if (item && typeof item === "object" && "result" in item) {
					return truncate(String(item.result ?? ""), 80);
				}
				return truncate(JSON.stringify(item), 80);
			})
			.filter((s) => s.length > 0);

		if (results.length === 0) {
			return "";
		}
		if (results.length === 1) {
			return results[0];
		}
		return `${results[0]} (+${results.length - 1} more)`;
	}

	return truncate(JSON.stringify(output), 100);
}

export function unlinkIfExists(filePath: string | null | undefined): void {
	if (!filePath) {
		return;
	}
	if (!existsSync(filePath)) {
		return;
	}
	try {
		unlinkSync(filePath);
	} catch {
		// Best-effort cleanup.
	}
}

export function readStdinUtf8(): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		process.stdin.on("data", (chunk: Buffer) =>
			chunks.push(Buffer.from(chunk)),
		);
		process.stdin.on("end", () =>
			resolve(Buffer.concat(chunks).toString("utf-8")),
		);
		process.stdin.on("error", reject);
	});
}

export function writeHookJson(value: unknown): void {
	try {
		process.stdout.write(JSON.stringify(value));
	} catch (error) {
		if (
			!(
				error &&
				typeof error === "object" &&
				"code" in error &&
				typeof (error as { code?: unknown }).code === "string" &&
				(error as { code: string }).code === "EPIPE"
			)
		) {
			throw error;
		}
	}
}

export function ensureHookLogDir(filePath?: string): string {
	if (filePath?.trim()) {
		const resolved = dirname(filePath);
		if (!existsSync(resolved)) {
			mkdirSync(resolved, { recursive: true });
		}
		return resolved;
	}
	const dir = join(resolveClineDataDir(), "hooks");
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	return dir;
}

function resolveClineDataDir(): string {
	const envPath = process.env.CLINE_DATA_DIR?.trim();
	if (envPath) {
		return envPath;
	}
	return join(homedir(), ".cline", "data");
}

export function appendHookAudit(event: HookEventPayload): void {
	const payloadHookPath = resolveHookLogPath(event.sessionContext);
	const envHookPath = process.env.CLINE_HOOKS_LOG_PATH?.trim() || undefined;
	const targetHookPath = payloadHookPath ?? envHookPath;
	const line = `${JSON.stringify({
		ts: new Date().toISOString(),
		...event,
	})}\n`;
	if (targetHookPath) {
		ensureHookLogDir(targetHookPath);
		appendFileSync(targetHookPath, line, "utf-8");
		return;
	}
	const dir = ensureHookLogDir();
	appendFileSync(join(dir, "hooks.jsonl"), line, "utf-8");
}

export function isCliHookPayload(value: unknown): value is HookEventPayload {
	return parseHookEventPayload(value) !== undefined;
}

export function parseCliHookPayload(
	value: unknown,
): HookEventPayload | undefined {
	return parseHookEventPayload(value);
}

export function parseArgs(args: string[]): ParsedArgs {
	const result: ParsedArgs = {
		interactive: false,
		showHelp: false,
		showVersion: false,
		showUsage: false,
		showTimings: false,
		outputMode: "text",
		mode: "act",
		sandbox: false,
		thinking: false,
		liveModelCatalog: false,
		enableSpawnAgent: true,
		enableAgentTeams: true,
		enableTools: true,
		defaultToolAutoApprove: true,
		toolPolicies: {},
	};

	const positional: string[] = [];
	let i = 0;

	while (i < args.length) {
		const arg = args[i];

		if (arg === "-h" || arg === "--help") {
			result.showHelp = true;
		} else if (arg === "-v" || arg === "--version") {
			result.showVersion = true;
		} else if (arg === "-i" || arg === "--interactive") {
			result.interactive = true;
		} else if (arg === "-u" || arg === "--usage") {
			result.showUsage = true;
		} else if (arg === "-t" || arg === "--timings") {
			result.showTimings = true;
		} else if (arg === "--thinking") {
			result.thinking = true;
		} else if (arg === "--refresh-models") {
			result.liveModelCatalog = true;
		} else if (arg === "--json") {
			result.outputMode = "json";
		} else if (arg === "--sandbox") {
			result.sandbox = true;
		} else if (arg === "--sandbox-dir") {
			result.sandboxDir = args[++i];
		} else if (arg === "--output") {
			const mode = (args[++i] ?? "").trim().toLowerCase();
			if (mode === "text" || mode === "json") {
				result.outputMode = mode;
			} else if (mode) {
				result.invalidOutputMode = mode;
			}
		} else if (arg === "--mode") {
			const mode = (args[++i] ?? "").trim().toLowerCase();
			if (mode === "act" || mode === "plan") {
				result.mode = mode;
			} else if (mode) {
				result.invalidMode = mode;
			}
		} else if (arg === "--spawn" || arg === "--enable-spawn") {
			result.enableSpawnAgent = true;
		} else if (arg === "--no-spawn") {
			result.enableSpawnAgent = false;
		} else if (arg === "--teams") {
			result.enableAgentTeams = true;
		} else if (arg === "--no-teams") {
			result.enableAgentTeams = false;
		} else if (arg === "--tools") {
			result.enableTools = true;
		} else if (arg === "--no-tools") {
			result.enableTools = false;
		} else if (arg === "--auto-approve-tools") {
			result.defaultToolAutoApprove = true;
		} else if (arg === "--require-tool-approval") {
			result.defaultToolAutoApprove = false;
		} else if (arg === "--tool-enable") {
			const name = (args[++i] ?? "").trim();
			if (name) {
				result.toolPolicies[name] = {
					...(result.toolPolicies[name] ?? {}),
					enabled: true,
				};
			}
		} else if (arg === "--tool-disable") {
			const name = (args[++i] ?? "").trim();
			if (name) {
				result.toolPolicies[name] = {
					...(result.toolPolicies[name] ?? {}),
					enabled: false,
				};
			}
		} else if (arg === "--tool-autoapprove") {
			const name = (args[++i] ?? "").trim();
			if (name) {
				result.toolPolicies[name] = {
					...(result.toolPolicies[name] ?? {}),
					autoApprove: true,
				};
			}
		} else if (arg === "--tool-require-approval") {
			const name = (args[++i] ?? "").trim();
			if (name) {
				result.toolPolicies[name] = {
					...(result.toolPolicies[name] ?? {}),
					autoApprove: false,
				};
			}
		} else if (arg === "--cwd") {
			result.cwd = args[++i];
		} else if (arg === "--team-name") {
			result.teamName = args[++i];
		} else if (arg === "--mission-step-interval") {
			result.missionLogIntervalSteps = Number.parseInt(args[++i], 10);
		} else if (arg === "--mission-time-interval-ms") {
			result.missionLogIntervalMs = Number.parseInt(args[++i], 10);
		} else if (arg === "-s" || arg === "--system") {
			result.systemPrompt = args[++i];
		} else if (arg === "-m" || arg === "--model") {
			result.model = args[++i];
		} else if (arg === "-p" || arg === "--provider") {
			result.provider = args[++i];
		} else if (arg === "-k" || arg === "--key") {
			result.key = args[++i];
		} else if (arg === "--session") {
			result.sessionId = args[++i] ?? "";
		} else if (arg === "-n" || arg === "--max-iterations") {
			result.maxIterations = Number.parseInt(args[++i], 10);
		} else if (!arg.startsWith("-")) {
			positional.push(arg);
		}

		i++;
	}

	if (positional.length > 0) {
		result.prompt = positional.join(" ");
	}

	return result;
}

export function resolveSandboxDataDir(
	cwd: string,
	explicitDir?: string,
): string {
	const envDir = process.env.CLINE_SANDBOX_DATA_DIR?.trim();
	const baseDir =
		explicitDir?.trim() || envDir || join(tmpdir(), "cline-sandbox");
	return resolve(cwd, baseDir);
}

export function configureSandboxEnvironment(options: {
	enabled: boolean;
	cwd: string;
	explicitDir?: string;
}): string | undefined {
	if (!options.enabled) {
		return undefined;
	}
	const dataDir = resolveSandboxDataDir(options.cwd, options.explicitDir);
	process.env.CLINE_SANDBOX = "1";
	process.env.CLINE_SANDBOX_DATA_DIR = dataDir;
	process.env.CLINE_DATA_DIR = dataDir;
	process.env.CLINE_SESSION_DATA_DIR = join(dataDir, "sessions");
	process.env.CLINE_TEAM_DATA_DIR = join(dataDir, "teams");
	process.env.CLINE_PROVIDER_SETTINGS_PATH = join(
		dataDir,
		"settings",
		"providers.json",
	);
	process.env.CLINE_HOOKS_LOG_PATH = join(dataDir, "hooks", "hooks.jsonl");
	return dataDir;
}
