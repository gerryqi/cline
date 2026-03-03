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
import type { Message } from "@cline/llms/providers";

const store = new SqliteSessionStore();
const coreSessions = new CoreSessionService(store);

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
	return coreSessions.createRootSessionWithArtifacts(input);
}

export function writeCliSessionManifest(
	manifestPath: string,
	manifest: SessionManifest,
): void {
	coreSessions.writeSessionManifest(manifestPath, manifest);
}

export function updateCliSessionStatusInStore(
	sessionId: string,
	status: SessionManifest["status"],
	exitCode?: number | null,
): { updated: boolean; endedAt?: string } {
	return coreSessions.updateSessionStatus(sessionId, status, exitCode);
}

export function queueSpawnRequest(event: HookEventPayload): void {
	coreSessions.queueSpawnRequest(event);
}

export function upsertSubagentSessionFromHook(
	event: HookEventPayload,
): string | undefined {
	return coreSessions.upsertSubagentSessionFromHook(event);
}

export function appendSubagentHookAudit(
	subSessionId: string,
	event: HookEventPayload,
): void {
	coreSessions.appendSubagentHookAudit(subSessionId, event);
}

export function appendSubagentTranscriptLine(
	subSessionId: string,
	line: string,
): void {
	coreSessions.appendSubagentTranscriptLine(subSessionId, line);
}

export function applySubagentStatus(
	subSessionId: string,
	event: HookEventPayload,
): void {
	coreSessions.applySubagentStatus(subSessionId, event);
}

export function onTeamTaskStart(agentId: string, message: string): void {
	coreSessions.onTeamTaskStart(agentId, message);
}

export function onTeamTaskEnd(
	agentId: string,
	status: SessionManifest["status"],
	summary?: string,
	messages?: Message[],
): void {
	coreSessions.onTeamTaskEnd(agentId, status, summary, messages);
}

export function handleSubAgentStart(context: SubAgentStartContext): void {
	coreSessions.handleSubAgentStart(context);
}

export function handleSubAgentEnd(context: SubAgentEndContext): void {
	coreSessions.handleSubAgentEnd(context);
}

export function listCliSessions(limit = 200): unknown[] {
	return coreSessions.listCliSessions(limit);
}

export function deleteCliSession(sessionId: string): { deleted: boolean } {
	return coreSessions.deleteCliSession(sessionId);
}
