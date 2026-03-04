import type * as grpc from "@grpc/grpc-js";
import { createGatewayGenericClient } from "./gateway-client.js";
import type { ClaimSpawnRequestRequest } from "./proto/generated/cline/rpc/v1/ClaimSpawnRequestRequest.js";
import type { ClaimSpawnRequestResponse__Output } from "./proto/generated/cline/rpc/v1/ClaimSpawnRequestResponse.js";
import type { ClineGatewayClient } from "./proto/generated/cline/rpc/v1/ClineGateway.js";
import type { DeleteSessionResponse__Output } from "./proto/generated/cline/rpc/v1/DeleteSessionResponse.js";
import type { EnqueueSpawnRequestResponse__Output } from "./proto/generated/cline/rpc/v1/EnqueueSpawnRequestResponse.js";
import type { GetSessionResponse__Output } from "./proto/generated/cline/rpc/v1/GetSessionResponse.js";
import type { ListSessionsResponse__Output } from "./proto/generated/cline/rpc/v1/ListSessionsResponse.js";
import type {
	SessionRecord,
	SessionRecord__Output,
} from "./proto/generated/cline/rpc/v1/SessionRecord.js";
import type { UpdateSessionRequest } from "./proto/generated/cline/rpc/v1/UpdateSessionRequest.js";
import type { UpdateSessionResponse__Output } from "./proto/generated/cline/rpc/v1/UpdateSessionResponse.js";
import type { UpsertSessionRequest } from "./proto/generated/cline/rpc/v1/UpsertSessionRequest.js";
import type { RpcSessionRow } from "./session-store.js";

function toMessage(row: RpcSessionRow): SessionRecord {
	return {
		sessionId: row.sessionId,
		source: row.source,
		pid: row.pid,
		startedAt: row.startedAt,
		endedAt: row.endedAt ?? "",
		exitCode: row.exitCode ?? 0,
		status: row.status,
		statusLock: row.statusLock,
		interactive: row.interactive,
		provider: row.provider,
		model: row.model,
		cwd: row.cwd,
		workspaceRoot: row.workspaceRoot,
		teamName: row.teamName ?? "",
		enableTools: row.enableTools,
		enableSpawn: row.enableSpawn,
		enableTeams: row.enableTeams,
		parentSessionId: row.parentSessionId ?? "",
		parentAgentId: row.parentAgentId ?? "",
		agentId: row.agentId ?? "",
		conversationId: row.conversationId ?? "",
		isSubagent: row.isSubagent,
		prompt: row.prompt ?? "",
		transcriptPath: row.transcriptPath,
		hookPath: row.hookPath,
		messagesPath: row.messagesPath ?? "",
		updatedAt: row.updatedAt,
	};
}

function fromMessage(message: SessionRecord__Output): RpcSessionRow {
	return {
		sessionId: message.sessionId ?? "",
		source: message.source ?? "",
		pid: Number(message.pid ?? 0),
		startedAt: message.startedAt ?? "",
		endedAt: message.endedAt ? message.endedAt : null,
		exitCode: typeof message.exitCode === "number" ? message.exitCode : null,
		status: (message.status as RpcSessionRow["status"]) ?? "running",
		statusLock: Number(message.statusLock ?? 0),
		interactive: message.interactive === true,
		provider: message.provider ?? "",
		model: message.model ?? "",
		cwd: message.cwd ?? "",
		workspaceRoot: message.workspaceRoot ?? "",
		teamName: message.teamName || undefined,
		enableTools: message.enableTools === true,
		enableSpawn: message.enableSpawn === true,
		enableTeams: message.enableTeams === true,
		parentSessionId: message.parentSessionId || undefined,
		parentAgentId: message.parentAgentId || undefined,
		agentId: message.agentId || undefined,
		conversationId: message.conversationId || undefined,
		isSubagent: message.isSubagent === true,
		prompt: message.prompt || undefined,
		transcriptPath: message.transcriptPath ?? "",
		hookPath: message.hookPath ?? "",
		messagesPath: message.messagesPath || undefined,
		updatedAt: message.updatedAt ?? "",
	};
}

export interface RpcSessionClientOptions {
	address: string;
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
	private readonly client: ClineGatewayClient;

	constructor(options: RpcSessionClientOptions) {
		this.client = createGatewayGenericClient(options.address);
	}

	public close(): void {
		this.client.close();
	}

	public async upsertSession(row: RpcSessionRow): Promise<void> {
		await this.unary((callback) => {
			const request: UpsertSessionRequest = { session: toMessage(row) };
			this.client.UpsertSession(request, callback);
		});
	}

	public async getSession(
		sessionId: string,
	): Promise<RpcSessionRow | undefined> {
		const response = await this.unary<GetSessionResponse__Output>(
			(callback) => {
				this.client.GetSession({ sessionId }, callback);
			},
		);
		if (!response.session) {
			return undefined;
		}
		return fromMessage(response.session);
	}

	public async listSessions(input: {
		limit: number;
		parentSessionId?: string;
		status?: string;
	}): Promise<RpcSessionRow[]> {
		const response = await this.unary<ListSessionsResponse__Output>(
			(callback) => {
				this.client.ListSessions(input, callback);
			},
		);
		return (response.sessions ?? []).map((item) => fromMessage(item));
	}

	public async updateSession(
		input: RpcSessionUpdateInput,
	): Promise<{ updated: boolean; statusLock: number }> {
		const request: UpdateSessionRequest = {
			sessionId: input.sessionId,
			status: input.status,
			endedAt: input.endedAt,
			setRunning: input.setRunning,
		};
		if (input.exitCode !== undefined) {
			request.hasExitCode = true;
			request.exitCode = input.exitCode ?? 0;
		}
		if (input.prompt !== undefined) {
			request.hasPrompt = true;
			request.prompt = input.prompt ?? "";
		}
		if (input.parentSessionId !== undefined) {
			request.hasParentSessionId = true;
			request.parentSessionId = input.parentSessionId ?? "";
		}
		if (input.parentAgentId !== undefined) {
			request.hasParentAgentId = true;
			request.parentAgentId = input.parentAgentId ?? "";
		}
		if (input.agentId !== undefined) {
			request.hasAgentId = true;
			request.agentId = input.agentId ?? "";
		}
		if (input.conversationId !== undefined) {
			request.hasConversationId = true;
			request.conversationId = input.conversationId ?? "";
		}
		if (input.expectedStatusLock !== undefined) {
			request.hasExpectedStatusLock = true;
			request.expectedStatusLock = input.expectedStatusLock;
		}
		const response = await this.unary<UpdateSessionResponse__Output>(
			(callback) => {
				this.client.UpdateSession(request, callback);
			},
		);
		return {
			updated: response.updated === true,
			statusLock: Number(response.statusLock ?? 0),
		};
	}

	public async deleteSession(
		sessionId: string,
		cascade = false,
	): Promise<boolean> {
		const response = await this.unary<DeleteSessionResponse__Output>(
			(callback) => {
				this.client.DeleteSession({ sessionId, cascade }, callback);
			},
		);
		return response.deleted === true;
	}

	public async enqueueSpawnRequest(input: {
		rootSessionId: string;
		parentAgentId: string;
		task?: string;
		systemPrompt?: string;
	}): Promise<void> {
		await this.unary<EnqueueSpawnRequestResponse__Output>((callback) => {
			this.client.EnqueueSpawnRequest(input, callback);
		});
	}

	public async claimSpawnRequest(
		rootSessionId: string,
		parentAgentId: string,
	): Promise<string | undefined> {
		const response = await this.unary<ClaimSpawnRequestResponse__Output>(
			(callback) => {
				const request: ClaimSpawnRequestRequest = {
					rootSessionId,
					parentAgentId,
				};
				this.client.ClaimSpawnRequest(request, callback);
			},
		);
		const task = response.item?.task?.trim();
		return task ? task : undefined;
	}

	private async unary<TResponse = unknown>(
		invoke: (
			callback: (
				error: grpc.ServiceError | null,
				response: TResponse | undefined,
			) => void,
		) => void,
	): Promise<TResponse> {
		return await new Promise<TResponse>((resolve, reject) => {
			invoke((error, response) => {
				if (error) {
					reject(error);
					return;
				}
				resolve((response ?? ({} as TResponse)) as TResponse);
			});
		});
	}
}
