import { spawn } from "node:child_process";
import type {
	AgentConfig,
	ToolApprovalRequest,
	ToolApprovalResult,
} from "@cline/agents";
import { getRpcServerHealth } from "@cline/rpc";
import type { ToolExecutors } from "../default-tools";
import { resolveSessionDataDir } from "../storage/paths";
import { SqliteSessionStore } from "../storage/sqlite-session-store";
import { DefaultSessionManager } from "./default-session-manager";
import { RpcCoreSessionService } from "./rpc-session-service";
import type { SessionManager } from "./session-manager";
import { CoreSessionService } from "./session-service";

const DEFAULT_RPC_ADDRESS =
	process.env.CLINE_RPC_ADDRESS?.trim() || "127.0.0.1:4317";

type SessionBackend = RpcCoreSessionService | CoreSessionService;

let cachedBackend: SessionBackend | undefined;
let backendInitPromise: Promise<SessionBackend> | undefined;

export interface CreateSessionHostOptions {
	sessionService?: SessionBackend;
	backendMode?: "auto" | "rpc" | "local";
	rpcAddress?: string;
	autoStartRpcServer?: boolean;
	rpcConnectAttempts?: number;
	rpcConnectDelayMs?: number;
	defaultToolExecutors?: Partial<ToolExecutors>;
	toolPolicies?: AgentConfig["toolPolicies"];
	requestToolApproval?: (
		request: ToolApprovalRequest,
	) => Promise<ToolApprovalResult>;
}

export type SessionHost = SessionManager;

function isLikelyScriptEntryPath(pathValue: string | undefined): boolean {
	if (!pathValue) {
		return false;
	}
	return /\.(?:[cm]?[jt]s|tsx?)$/i.test(pathValue);
}

function startRpcServerInBackground(address: string): void {
	const launcher = process.argv[0];
	const entry = process.argv[1];
	const startArgs = ["rpc", "start", "--address", address];
	const args =
		entry && isLikelyScriptEntryPath(entry) ? [entry, ...startArgs] : startArgs;

	const child = spawn(launcher, args, {
		detached: true,
		stdio: "ignore",
		env: process.env,
		cwd: process.cwd(),
	});
	child.unref();
}

async function tryConnectRpcBackend(
	address: string,
): Promise<RpcCoreSessionService | undefined> {
	try {
		const health = await getRpcServerHealth(address);
		if (!health) {
			return undefined;
		}
		return new RpcCoreSessionService({
			address,
			sessionsDir: resolveSessionDataDir(),
		});
	} catch {
		return undefined;
	}
}

function createLocalBackend(): CoreSessionService {
	return new CoreSessionService(new SqliteSessionStore());
}

async function resolveBackend(
	options: CreateSessionHostOptions,
): Promise<SessionBackend> {
	if (cachedBackend) {
		return cachedBackend;
	}
	if (backendInitPromise) {
		return await backendInitPromise;
	}

	const mode = options.backendMode ?? "auto";
	const address = options.rpcAddress?.trim() || DEFAULT_RPC_ADDRESS;
	const attempts = Math.max(1, options.rpcConnectAttempts ?? 5);
	const delayMs = Math.max(0, options.rpcConnectDelayMs ?? 100);
	const autoStartRpc = options.autoStartRpcServer !== false;

	backendInitPromise = (async () => {
		if (mode === "local") {
			cachedBackend = createLocalBackend();
			return cachedBackend;
		}

		const existingRpcBackend = await tryConnectRpcBackend(address);
		if (existingRpcBackend) {
			cachedBackend = existingRpcBackend;
			return cachedBackend;
		}

		if (mode === "rpc") {
			throw new Error(`RPC backend unavailable at ${address}`);
		}

		if (autoStartRpc) {
			try {
				startRpcServerInBackground(address);
			} catch {
				// Ignore launch failures and fall back to local backend.
			}

			for (let attempt = 0; attempt < attempts; attempt += 1) {
				const rpcBackend = await tryConnectRpcBackend(address);
				if (rpcBackend) {
					cachedBackend = rpcBackend;
					return cachedBackend;
				}
				if (delayMs > 0) {
					await new Promise((resolve) => setTimeout(resolve, delayMs));
				}
			}
		}

		cachedBackend = createLocalBackend();
		return cachedBackend;
	})().finally(() => {
		backendInitPromise = undefined;
	});

	return await backendInitPromise;
}

export async function createSessionHost(
	options: CreateSessionHostOptions = {},
): Promise<SessionHost> {
	const backend = options.sessionService ?? (await resolveBackend(options));
	return new DefaultSessionManager({
		sessionService: backend,
		defaultToolExecutors: options.defaultToolExecutors,
		toolPolicies: options.toolPolicies,
		requestToolApproval: options.requestToolApproval,
	});
}
