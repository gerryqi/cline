declare module "@cline/rpc" {
	export interface RpcSessionRow {
		sessionId: string;
		source: string;
		pid: number;
		startedAt: string;
		endedAt?: string | null;
		exitCode?: number | null;
		status: "running" | "completed" | "failed" | "cancelled";
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

	export interface RpcSessionUpdateInput {
		sessionId: string;
		status?: string;
		endedAt?: string;
		exitCode?: number | null;
		prompt?: string | null;
		parentSessionId?: string | null;
		parentAgentId?: string | null;
		agentId?: string | null;
		conversationId?: string | null;
		expectedStatusLock?: number;
		setRunning?: boolean;
	}

	export class RpcSessionClient {
		constructor(options: { address: string });
		close(): void;
		upsertSession(row: RpcSessionRow): Promise<void>;
		getSession(sessionId: string): Promise<RpcSessionRow | undefined>;
		listSessions(input: {
			limit: number;
			parentSessionId?: string;
			status?: string;
		}): Promise<RpcSessionRow[]>;
		updateSession(
			input: RpcSessionUpdateInput,
		): Promise<{ updated: boolean; statusLock: number }>;
		deleteSession(sessionId: string, cascade?: boolean): Promise<boolean>;
		enqueueSpawnRequest(input: {
			rootSessionId: string;
			parentAgentId: string;
			task?: string;
			systemPrompt?: string;
		}): Promise<void>;
		claimSpawnRequest(
			rootSessionId: string,
			parentAgentId: string,
		): Promise<string | undefined>;
	}
}
