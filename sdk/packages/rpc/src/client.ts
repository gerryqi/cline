import type * as grpc from "@grpc/grpc-js";
import { createGatewayGenericClient } from "./gateway-client.js";
import type { AbortRuntimeSessionResponse__Output } from "./proto/generated/cline/rpc/v1/AbortRuntimeSessionResponse.js";
import type { ClaimSpawnRequestRequest } from "./proto/generated/cline/rpc/v1/ClaimSpawnRequestRequest.js";
import type { ClaimSpawnRequestResponse__Output } from "./proto/generated/cline/rpc/v1/ClaimSpawnRequestResponse.js";
import type { ClineGatewayClient } from "./proto/generated/cline/rpc/v1/ClineGateway.js";
import type { DeleteSessionResponse__Output } from "./proto/generated/cline/rpc/v1/DeleteSessionResponse.js";
import type { EnqueueSpawnRequestResponse__Output } from "./proto/generated/cline/rpc/v1/EnqueueSpawnRequestResponse.js";
import type { GetSessionResponse__Output } from "./proto/generated/cline/rpc/v1/GetSessionResponse.js";
import type { ListSessionsResponse__Output } from "./proto/generated/cline/rpc/v1/ListSessionsResponse.js";
import type { PublishEventResponse__Output } from "./proto/generated/cline/rpc/v1/PublishEventResponse.js";
import type { RoutedEvent__Output } from "./proto/generated/cline/rpc/v1/RoutedEvent.js";
import type { RunProviderActionResponse__Output } from "./proto/generated/cline/rpc/v1/RunProviderActionResponse.js";
import type { RunProviderOAuthLoginResponse__Output } from "./proto/generated/cline/rpc/v1/RunProviderOAuthLoginResponse.js";
import type { SendRuntimeSessionResponse__Output } from "./proto/generated/cline/rpc/v1/SendRuntimeSessionResponse.js";
import type {
	SessionRecord,
	SessionRecord__Output,
} from "./proto/generated/cline/rpc/v1/SessionRecord.js";
import type { StartRuntimeSessionResponse__Output } from "./proto/generated/cline/rpc/v1/StartRuntimeSessionResponse.js";
import type { UpdateSessionRequest } from "./proto/generated/cline/rpc/v1/UpdateSessionRequest.js";
import type { UpdateSessionResponse__Output } from "./proto/generated/cline/rpc/v1/UpdateSessionResponse.js";
import type { UpsertSessionRequest } from "./proto/generated/cline/rpc/v1/UpsertSessionRequest.js";
import type { RpcSessionRow, RpcSessionUpdateInput } from "./types.js";

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

export interface RpcStreamEventsInput {
	clientId?: string;
	sessionIds?: string[];
}

export interface RpcStreamEventsHandlers {
	onEvent?: (event: {
		eventId: string;
		sessionId: string;
		taskId?: string;
		eventType: string;
		payloadJson: string;
		sourceClientId?: string;
		ts: string;
	}) => void;
	onError?: (error: Error) => void;
	onEnd?: () => void;
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
			endedAt: input.endedAt ?? undefined,
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

	public async startRuntimeSession(
		requestJson: string,
	): Promise<{ sessionId: string; startResultJson: string }> {
		const response = await this.unary<StartRuntimeSessionResponse__Output>(
			(callback) => {
				this.client.StartRuntimeSession({ requestJson }, callback);
			},
		);
		return {
			sessionId: response.sessionId ?? "",
			startResultJson: response.startResultJson ?? "",
		};
	}

	public async sendRuntimeSession(
		sessionId: string,
		requestJson: string,
	): Promise<{ resultJson: string }> {
		const response = await this.unary<SendRuntimeSessionResponse__Output>(
			(callback) => {
				this.client.SendRuntimeSession({ sessionId, requestJson }, callback);
			},
		);
		return { resultJson: response.resultJson ?? "" };
	}

	public async abortRuntimeSession(
		sessionId: string,
	): Promise<{ applied: boolean }> {
		const response = await this.unary<AbortRuntimeSessionResponse__Output>(
			(callback) => {
				this.client.AbortRuntimeSession({ sessionId }, callback);
			},
		);
		return { applied: response.applied === true };
	}

	public async runProviderAction(
		requestJson: string,
	): Promise<{ resultJson: string }> {
		const response = await this.unary<RunProviderActionResponse__Output>(
			(callback) => {
				this.client.RunProviderAction({ requestJson }, callback);
			},
		);
		return { resultJson: response.resultJson ?? "" };
	}

	public async runProviderOAuthLogin(
		provider: string,
	): Promise<{ provider: string; apiKey: string }> {
		const response = await this.unary<RunProviderOAuthLoginResponse__Output>(
			(callback) => {
				this.client.RunProviderOAuthLogin({ provider }, callback);
			},
		);
		return {
			provider: response.provider ?? "",
			apiKey: response.apiKey ?? "",
		};
	}

	public async publishEvent(input: {
		eventId?: string;
		sessionId: string;
		taskId?: string;
		eventType: string;
		payloadJson: string;
		sourceClientId?: string;
	}): Promise<{ eventId: string; accepted: boolean }> {
		const response = await this.unary<PublishEventResponse__Output>(
			(callback) => {
				this.client.PublishEvent(input, callback);
			},
		);
		return {
			eventId: response.eventId ?? "",
			accepted: response.accepted === true,
		};
	}

	public streamEvents(
		input: RpcStreamEventsInput,
		handlers: RpcStreamEventsHandlers = {},
	): () => void {
		let closing = false;
		const stream = this.client.StreamEvents({
			clientId: input.clientId ?? "",
			sessionIds: input.sessionIds ?? [],
		});
		const onData = (event: RoutedEvent__Output) => {
			handlers.onEvent?.({
				eventId: event.eventId ?? "",
				sessionId: event.sessionId ?? "",
				taskId: event.taskId?.trim() ? event.taskId : undefined,
				eventType: event.eventType ?? "",
				payloadJson: event.payloadJson ?? "",
				sourceClientId: event.sourceClientId?.trim()
					? event.sourceClientId
					: undefined,
				ts: event.ts ?? "",
			});
		};
		const onError = (error: Error) => {
			const grpcCode =
				typeof (error as { code?: unknown }).code === "number"
					? Number((error as { code?: unknown }).code)
					: undefined;
			const isCancelled = grpcCode === 1 || error.message.includes("CANCELLED");
			if (closing && isCancelled) {
				return;
			}
			handlers.onError?.(error);
		};
		const onEnd = () => {
			handlers.onEnd?.();
		};
		stream.on("data", onData);
		stream.on("error", onError);
		stream.on("end", onEnd);
		return () => {
			closing = true;
			stream.cancel();
		};
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
