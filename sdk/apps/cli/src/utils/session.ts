import { spawn } from "node:child_process";
import {
	CoreSessionService,
	createSessionHost,
	RpcCoreSessionService,
	resolveSessionDataDir,
	type SessionManifest,
	SqliteSessionStore,
} from "@cline/core/server";
import { getRpcServerHealth } from "@cline/rpc";

const DEFAULT_RPC_ADDRESS =
	process.env.CLINE_RPC_ADDRESS?.trim() || "127.0.0.1:4317";

let coreSessions: RpcCoreSessionService | undefined;
let localSessions: CoreSessionService | undefined;
let initPromise:
	| Promise<RpcCoreSessionService | CoreSessionService>
	| undefined;

export interface CliSessionManager {
	start(input: {
		config: import("@cline/core/server").CoreSessionConfig;
		source?: import("@cline/core/server").SessionSource;
		prompt?: string;
		interactive?: boolean;
		initialMessages?: import("@cline/llms").providers.Message[];
		userImages?: string[];
		userFiles?: string[];
		userInstructionWatcher?: import("@cline/core/server").UserInstructionConfigWatcher;
		onTeamRestored?: () => void;
		defaultToolExecutors?: Partial<import("@cline/core/server").ToolExecutors>;
		toolPolicies?: import("@cline/agents").AgentConfig["toolPolicies"];
		requestToolApproval?: (
			request: import("@cline/agents").ToolApprovalRequest,
		) => Promise<import("@cline/agents").ToolApprovalResult>;
	}): Promise<{
		sessionId: string;
		manifest: SessionManifest;
		manifestPath: string;
		transcriptPath: string;
		hookPath: string;
		messagesPath: string;
		result?: import("@cline/agents").AgentResult;
	}>;
	send(input: {
		sessionId: string;
		prompt: string;
		userImages?: string[];
		userFiles?: string[];
	}): Promise<import("@cline/agents").AgentResult | undefined>;
	readMessages(
		sessionId: string,
	): Promise<import("@cline/llms").providers.Message[]>;
	abort(sessionId: string): Promise<void>;
	stop(sessionId: string): Promise<void>;
	subscribe(listener: (event: unknown) => void): () => void;
}

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

async function tryConnectRpcSessions(
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

async function getCoreSessions(): Promise<
	RpcCoreSessionService | CoreSessionService
> {
	if (coreSessions) {
		return coreSessions;
	}
	if (localSessions) {
		return localSessions;
	}
	if (!initPromise) {
		initPromise = (async () => {
			const existingRpcSessions =
				await tryConnectRpcSessions(DEFAULT_RPC_ADDRESS);
			if (existingRpcSessions) {
				coreSessions = existingRpcSessions;
				return coreSessions;
			}

			// No healthy RPC server was detected; spawn one in the background.
			try {
				startRpcServerInBackground(DEFAULT_RPC_ADDRESS);
			} catch {
				// Ignore launch failures and fall back to local storage.
			}

			// Give the detached RPC process a brief chance to bind.
			for (let attempt = 0; attempt < 5; attempt += 1) {
				const rpcSessions = await tryConnectRpcSessions(DEFAULT_RPC_ADDRESS);
				if (rpcSessions) {
					coreSessions = rpcSessions;
					return coreSessions;
				}
				await new Promise((resolve) => setTimeout(resolve, 100));
			}

			// Fallback when background RPC launch is unavailable.
			localSessions = new CoreSessionService(new SqliteSessionStore());
			return localSessions;
		})();
	}
	return await initPromise;
}

export async function getCoreSessionBackend(): Promise<
	RpcCoreSessionService | CoreSessionService
> {
	return getCoreSessions();
}

export async function createDefaultCliSessionManager(options?: {
	defaultToolExecutors?: Partial<import("@cline/core/server").ToolExecutors>;
	toolPolicies?: import("@cline/agents").AgentConfig["toolPolicies"];
	requestToolApproval?: (
		request: import("@cline/agents").ToolApprovalRequest,
	) => Promise<import("@cline/agents").ToolApprovalResult>;
}): Promise<CliSessionManager> {
	return (await createSessionHost({
		sessionService: await getCoreSessions(),
		defaultToolExecutors: options?.defaultToolExecutors,
		toolPolicies: options?.toolPolicies,
		requestToolApproval: options?.requestToolApproval,
	})) as CliSessionManager;
}

export async function listSessions(limit = 200): Promise<unknown[]> {
	return await (await getCoreSessions()).listSessions(limit);
}

export async function deleteSession(
	sessionId: string,
): Promise<{ deleted: boolean }> {
	return await (await getCoreSessions()).deleteSession(sessionId);
}
