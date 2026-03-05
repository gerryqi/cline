import type { RpcSessionRow, RpcSessionUpdateInput } from "./types.js";
export interface RpcSessionClientOptions {
	address: string;
}
export declare class RpcSessionClient {
	private readonly client;
	constructor(options: RpcSessionClientOptions);
	close(): void;
	upsertSession(row: RpcSessionRow): Promise<void>;
	getSession(sessionId: string): Promise<RpcSessionRow | undefined>;
	listSessions(input: {
		limit: number;
		parentSessionId?: string;
		status?: string;
	}): Promise<RpcSessionRow[]>;
	updateSession(input: RpcSessionUpdateInput): Promise<{
		updated: boolean;
		statusLock: number;
	}>;
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
	private unary;
}
