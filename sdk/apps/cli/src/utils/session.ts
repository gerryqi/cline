import { spawn } from "node:child_process";
import type {
	HookEventPayload,
	SubAgentEndContext,
	SubAgentStartContext,
} from "@cline/agents";
import {
	CoreSessionService,
	type RootSessionArtifacts,
	RpcCoreSessionService,
	resolveSessionDataDir,
	type SessionManifest,
	SqliteSessionStore,
} from "@cline/core/server";
import type { providers as LlmsProviders } from "@cline/llms";
import { getRpcServerHealth } from "@cline/rpc";

const DEFAULT_RPC_ADDRESS =
	process.env.CLINE_RPC_ADDRESS?.trim() || "127.0.0.1:4317";

let coreSessions: RpcCoreSessionService | undefined;
let localSessions: CoreSessionService | undefined;
let initPromise:
	| Promise<RpcCoreSessionService | CoreSessionService>
	| undefined;

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

export async function createRootCliSessionWithArtifacts(input: {
	sessionId: string;
	source: SessionManifest["source"];
	pid: number;
	interactive: boolean;
	provider: string;
	model: string;
	cwd: string;
	workspaceRoot: string;
	teamName?: string;
	enableTools: boolean;
	enableSpawn: boolean;
	enableTeams: boolean;
	prompt?: string;
	startedAt?: string;
}): Promise<RootSessionArtifacts> {
	return await (await getCoreSessions()).createRootSessionWithArtifacts(input);
}

export async function writeCliSessionManifest(
	manifestPath: string,
	manifest: SessionManifest,
): Promise<void> {
	(await getCoreSessions()).writeSessionManifest(manifestPath, manifest);
}

export async function updateCliSessionStatusInStore(
	sessionId: string,
	status: SessionManifest["status"],
	exitCode?: number | null,
): Promise<{ updated: boolean; endedAt?: string }> {
	return await (await getCoreSessions()).updateSessionStatus(
		sessionId,
		status,
		exitCode,
	);
}

export async function queueSpawnRequest(
	event: HookEventPayload,
): Promise<void> {
	await (await getCoreSessions()).queueSpawnRequest(event);
}

export async function upsertSubagentSessionFromHook(
	event: HookEventPayload,
): Promise<string | undefined> {
	return await (await getCoreSessions()).upsertSubagentSessionFromHook(event);
}

export async function appendSubagentHookAudit(
	subSessionId: string,
	event: HookEventPayload,
): Promise<void> {
	await (await getCoreSessions()).appendSubagentHookAudit(subSessionId, event);
}

export async function appendSubagentTranscriptLine(
	subSessionId: string,
	line: string,
): Promise<void> {
	await (await getCoreSessions()).appendSubagentTranscriptLine(
		subSessionId,
		line,
	);
}

export async function applySubagentStatus(
	subSessionId: string,
	event: HookEventPayload,
): Promise<void> {
	await (await getCoreSessions()).applySubagentStatus(subSessionId, event);
}

export async function onTeamTaskStart(
	agentId: string,
	message: string,
): Promise<void> {
	await (await getCoreSessions()).onTeamTaskStart(agentId, message);
}

export async function onTeamTaskEnd(
	agentId: string,
	status: SessionManifest["status"],
	summary?: string,
	messages?: LlmsProviders.Message[],
): Promise<void> {
	await (await getCoreSessions()).onTeamTaskEnd(
		agentId,
		status,
		summary,
		messages,
	);
}

export async function handleSubAgentStart(
	context: SubAgentStartContext,
): Promise<void> {
	await (await getCoreSessions()).handleSubAgentStart(context);
}

export async function handleSubAgentEnd(
	context: SubAgentEndContext,
): Promise<void> {
	await (await getCoreSessions()).handleSubAgentEnd(context);
}

export async function listCliSessions(limit = 200): Promise<unknown[]> {
	return await (await getCoreSessions()).listCliSessions(limit);
}

export async function deleteCliSession(
	sessionId: string,
): Promise<{ deleted: boolean }> {
	return await (await getCoreSessions()).deleteCliSession(sessionId);
}
