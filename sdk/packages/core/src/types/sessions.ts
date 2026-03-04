import type { SessionSource, SessionStatus } from "./common";

export interface SessionRef {
	sessionId: string;
	parentSessionId?: string;
	agentId?: string;
	parentAgentId?: string;
	conversationId?: string;
	isSubagent: boolean;
}

export interface SessionRecord extends SessionRef {
	source: SessionSource;
	pid?: number;
	startedAt: string;
	endedAt?: string | null;
	exitCode?: number | null;
	status: SessionStatus;
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
	transcriptPath?: string;
	hookPath?: string;
	messagesPath?: string;
	updatedAt: string;
}
