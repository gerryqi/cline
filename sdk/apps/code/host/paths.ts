import { execFileSync, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { resolveSessionDataDir } from "@clinebot/shared/storage";
import type { HostContext, JsonRecord } from "./types";

export function resolveWorkspaceRoot(launchCwd: string): string {
	const cwd = resolve(launchCwd);
	try {
		const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		})
			.trim()
			.replace(/[\\/]+$/, "");
		return root || cwd;
	} catch {
		return cwd;
	}
}

export function runCliRpcOutputCommand(
	ctx: HostContext,
	args: string[],
): string {
	const cliteCmd = process.env.CLINE_CLI_COMMAND?.trim() || "clite";
	const result = spawnSync(cliteCmd, ["rpc", ...args], {
		cwd: ctx.workspaceRoot,
		encoding: "utf8",
	});
	if (result.status === 0) {
		return result.stdout.trim();
	}
	const message = result.stderr.trim() || result.stdout.trim();
	throw new Error(
		message || `failed running ${cliteCmd} rpc ${args.join(" ")}`,
	);
}

export function bootstrapRpcGateway(ctx: HostContext) {
	const requestedAddress =
		process.env.CLINE_RPC_ADDRESS?.trim() || "127.0.0.1:4317";
	const ensuredRaw = runCliRpcOutputCommand(ctx, [
		"ensure",
		"--address",
		requestedAddress,
		"--json",
	]);
	const ensured = JSON.parse(ensuredRaw) as { address?: string };
	ctx.rpcAddress = ensured.address?.trim() || requestedAddress;
	process.env.CLINE_RPC_ADDRESS = ctx.rpcAddress;
	runCliRpcOutputCommand(ctx, [
		"register",
		"--address",
		ctx.rpcAddress,
		"--client-id",
		"code-desktop",
		"--client-type",
		"desktop",
		"--meta",
		"app=code",
		"--meta",
		"host=desktop-backend",
	]);
}

export function resolveCliEntrypointPath(ctx: HostContext): string | null {
	const candidates = [
		join(ctx.workspaceRoot, "apps", "cli", "src", "index.ts"),
		join(ctx.workspaceRoot, "packages", "cli", "src", "index.ts"),
		join(ctx.workspaceRoot, "cli", "src", "index.ts"),
	];
	return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

export function resolveScriptPath(
	ctx: HostContext,
	fileName: string,
): string | null {
	const candidates = [
		join(ctx.workspaceRoot, "apps", "code", "scripts", fileName),
		join(ctx.workspaceRoot, "scripts", fileName),
		join(process.cwd(), "scripts", fileName),
		join(process.cwd(), "apps", "code", "scripts", fileName),
	];
	return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

export function runBunScriptJson(
	scriptPath: string,
	stdinBody: Record<string, unknown>,
): unknown {
	const scriptWorkdir = dirname(dirname(scriptPath));
	const result = spawnSync("bun", ["run", scriptPath], {
		cwd: scriptWorkdir,
		input: JSON.stringify(stdinBody),
		encoding: "utf8",
		env: process.env,
	});
	if (result.status !== 0) {
		throw new Error(
			result.stderr.trim() || result.stdout.trim() || "bun script failed",
		);
	}
	return JSON.parse(result.stdout.trim());
}

export function kanbanDataRoot(): string {
	return (
		process.env.CLINE_KANBAN_DATA_DIR?.trim() ||
		join(homedir(), ".cline", "apps", "kanban")
	);
}

export function sessionLogPath(sessionId: string): string {
	return join(kanbanDataRoot(), "sessions", `${sessionId}.jsonl`);
}

export function sessionHookLogPath(sessionId: string): string {
	return join(kanbanDataRoot(), "hooks", `${sessionId}.jsonl`);
}

export function sharedSessionDataDir(): string {
	return process.env.CLINE_SESSION_DATA_DIR?.trim() || resolveSessionDataDir();
}

export function sharedSessionArtifactPath(
	sessionId: string,
	suffix: string,
): string {
	return join(sharedSessionDataDir(), sessionId, `${sessionId}.${suffix}`);
}

export function sharedSessionLogPath(sessionId: string): string {
	return sharedSessionArtifactPath(sessionId, "log");
}

export function sharedSessionHookPath(sessionId: string): string {
	return sharedSessionArtifactPath(sessionId, "hooks.jsonl");
}

export function sharedSessionMessagesPath(sessionId: string): string {
	return sharedSessionArtifactPath(sessionId, "messages.json");
}

export function sharedSessionMessagesWritePath(sessionId: string): string {
	return sharedSessionMessagesPath(sessionId);
}

export function toolApprovalDir(): string {
	return (
		process.env.CLINE_TOOL_APPROVAL_DIR?.trim() ||
		join(sharedSessionDataDir(), "tool-approvals")
	);
}

export function toolApprovalDecisionPath(
	sessionId: string,
	requestId: string,
): string {
	return join(toolApprovalDir(), `${sessionId}.decision.${requestId}.json`);
}

export function toolApprovalRequestPrefix(sessionId: string): string {
	return `${sessionId}.request.`;
}

export function rootSessionIdFrom(sessionId: string): string {
	return sessionId.split("__")[0] || sessionId;
}

export function findArtifactUnderDir(
	dir: string,
	fileName: string,
	maxDepth: number,
): string | null {
	if (!existsSync(dir)) {
		return null;
	}
	const stack: Array<{ dir: string; depth: number }> = [{ dir, depth: 0 }];
	while (stack.length > 0) {
		const current = stack.pop();
		if (!current) {
			break;
		}
		for (const entry of readdirSync(current.dir, { withFileTypes: true })) {
			const path = join(current.dir, entry.name);
			if (entry.isFile() && entry.name === fileName) {
				return path;
			}
			if (entry.isDirectory() && current.depth < maxDepth) {
				stack.push({ dir: path, depth: current.depth + 1 });
			}
		}
	}
	return null;
}

export function readSessionManifest(sessionId: string): JsonRecord | null {
	const path = join(sharedSessionDataDir(), sessionId, `${sessionId}.json`);
	if (!existsSync(path)) {
		return null;
	}
	try {
		return JSON.parse(readFileSync(path, "utf8")) as JsonRecord;
	} catch {
		return null;
	}
}

export function writeSessionManifest(
	sessionId: string,
	manifest: JsonRecord,
): void {
	const path = join(sharedSessionDataDir(), sessionId, `${sessionId}.json`);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

export function resolveMcpSettingsPath(): string {
	return (
		process.env.CLINE_MCP_SETTINGS_PATH?.trim() ||
		join(homedir(), ".cline", "data", "settings", "cline_mcp_settings.json")
	);
}
