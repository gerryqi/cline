export type SessionHistoryStatus =
	| "running"
	| "completed"
	| "failed"
	| "cancelled"
	| "idle";

export interface SessionHistoryItem {
	sessionId: string;
	status: SessionHistoryStatus;
	provider: string;
	model: string;
	cwd: string;
	workspaceRoot: string;
	parentSessionId?: string;
	isSubagent?: boolean;
	prompt?: string;
	startedAt: string;
	endedAt?: string;
}
