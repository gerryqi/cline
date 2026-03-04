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
import { getRpcServerHealth, startRpcServer } from "@cline/rpc";

const DEFAULT_RPC_ADDRESS =
	process.env.CLINE_RPC_ADDRESS?.trim() || "127.0.0.1:4317";

let coreSessions: RpcCoreSessionService | undefined;
let localSessions: CoreSessionService | undefined;
let initPromise:
	| Promise<RpcCoreSessionService | CoreSessionService>
	| undefined;

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
			try {
				const health = await getRpcServerHealth(DEFAULT_RPC_ADDRESS);
				if (!health) {
					await startRpcServer({ address: DEFAULT_RPC_ADDRESS });
				}
				coreSessions = new RpcCoreSessionService({
					address: DEFAULT_RPC_ADDRESS,
					sessionsDir: resolveSessionDataDir(),
				});
				return coreSessions;
			} catch {
				// Fallback for server environments where RPC cannot be bound/started.
				localSessions = new CoreSessionService(new SqliteSessionStore());
				return localSessions;
			}
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
