export interface RpcServerOptions {
	address?: string;
	sessionBackend: RpcSessionBackend;
}

export interface RpcServerHandle {
	serverId: string;
	address: string;
	port: number;
	startedAt: string;
	stop: () => Promise<void>;
}

export interface RoutedEvent {
	eventId: string;
	sessionId: string;
	taskId?: string;
	eventType: string;
	payloadJson: string;
	sourceClientId?: string;
	ts: string;
}

export interface PendingApproval {
	approvalId: string;
	sessionId: string;
	taskId?: string;
	toolCallId: string;
	toolName: string;
	inputJson: string;
	requesterClientId?: string;
	createdAt: string;
}

export type RpcSessionStatus = "running" | "completed" | "failed" | "cancelled";

export interface RpcSessionRow {
	sessionId: string;
	source: string;
	pid: number;
	startedAt: string;
	endedAt?: string | null;
	exitCode?: number | null;
	status: RpcSessionStatus;
	statusLock: number;
	interactive: boolean;
	provider: string;
	model: string;
	cwd: string;
	workspaceRoot: string;
	teamName?: string;
	enableTools: boolean;
	enableSpawn: boolean;
	enableTeams: boolean;
	parentSessionId?: string;
	parentAgentId?: string;
	agentId?: string;
	conversationId?: string;
	isSubagent: boolean;
	prompt?: string;
	transcriptPath: string;
	hookPath: string;
	messagesPath?: string;
	updatedAt: string;
}

export interface RpcSpawnQueueItem {
	id: number;
	rootSessionId: string;
	parentAgentId: string;
	task?: string;
	systemPrompt?: string;
	createdAt: string;
	consumedAt?: string;
}

export interface RpcSessionUpdateInput {
	sessionId: string;
	status?: RpcSessionStatus;
	endedAt?: string | null;
	exitCode?: number | null;
	prompt?: string | null;
	parentSessionId?: string | null;
	parentAgentId?: string | null;
	agentId?: string | null;
	conversationId?: string | null;
	expectedStatusLock?: number;
	setRunning?: boolean;
}

export interface RpcSessionBackend {
	init(): void;
	upsertSession(row: RpcSessionRow): void;
	getSession(sessionId: string): RpcSessionRow | undefined;
	listSessions(options: {
		limit: number;
		parentSessionId?: string;
		status?: string;
	}): RpcSessionRow[];
	updateSession(input: RpcSessionUpdateInput): {
		updated: boolean;
		statusLock: number;
	};
	deleteSession(sessionId: string): boolean;
	deleteSessionsByParent(parentSessionId: string): void;
	enqueueSpawnRequest(input: {
		rootSessionId: string;
		parentAgentId: string;
		task?: string;
		systemPrompt?: string;
	}): void;
	claimSpawnRequest(
		rootSessionId: string,
		parentAgentId: string,
	): RpcSpawnQueueItem | undefined;
}
