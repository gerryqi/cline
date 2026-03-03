import type {
	HookEventPayload,
	SubAgentEndContext,
	SubAgentStartContext,
} from "@cline/agents";
import {
	CoreSessionService,
	type RootSessionArtifacts,
	type SessionManifest,
	SqliteSessionStore,
} from "@cline/core/server";
import type { providers as LlmsProviders } from "@cline/llms";

let coreSessions: CoreSessionService | undefined;

function getCoreSessions(): CoreSessionService {
	if (!coreSessions) {
		const store = new SqliteSessionStore();
		coreSessions = new CoreSessionService(store);
	}
	return coreSessions;
}

export function createRootCliSessionWithArtifacts(input: {
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
}): RootSessionArtifacts {
	return getCoreSessions().createRootSessionWithArtifacts(input);
}

export function writeCliSessionManifest(
	manifestPath: string,
	manifest: SessionManifest,
): void {
	getCoreSessions().writeSessionManifest(manifestPath, manifest);
}

export function updateCliSessionStatusInStore(
	sessionId: string,
	status: SessionManifest["status"],
	exitCode?: number | null,
): { updated: boolean; endedAt?: string } {
	return getCoreSessions().updateSessionStatus(sessionId, status, exitCode);
}

export function queueSpawnRequest(event: HookEventPayload): void {
	getCoreSessions().queueSpawnRequest(event);
}

export function upsertSubagentSessionFromHook(
	event: HookEventPayload,
): string | undefined {
	return getCoreSessions().upsertSubagentSessionFromHook(event);
}

export function appendSubagentHookAudit(
	subSessionId: string,
	event: HookEventPayload,
): void {
	getCoreSessions().appendSubagentHookAudit(subSessionId, event);
}

export function appendSubagentTranscriptLine(
	subSessionId: string,
	line: string,
): void {
	getCoreSessions().appendSubagentTranscriptLine(subSessionId, line);
}

export function applySubagentStatus(
	subSessionId: string,
	event: HookEventPayload,
): void {
	getCoreSessions().applySubagentStatus(subSessionId, event);
}

export function onTeamTaskStart(agentId: string, message: string): void {
	getCoreSessions().onTeamTaskStart(agentId, message);
}

export function onTeamTaskEnd(
	agentId: string,
	status: SessionManifest["status"],
	summary?: string,
	messages?: LlmsProviders.Message[],
): void {
	getCoreSessions().onTeamTaskEnd(agentId, status, summary, messages);
}

export function handleSubAgentStart(context: SubAgentStartContext): void {
	getCoreSessions().handleSubAgentStart(context);
}

export function handleSubAgentEnd(context: SubAgentEndContext): void {
	getCoreSessions().handleSubAgentEnd(context);
}

export function listCliSessions(limit = 200): unknown[] {
	return getCoreSessions().listCliSessions(limit);
}

export function deleteCliSession(sessionId: string): { deleted: boolean } {
	return getCoreSessions().deleteCliSession(sessionId);
}
