import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import type { ClaimSpawnRequestRequest__Output } from "./proto/generated/cline/rpc/v1/ClaimSpawnRequestRequest.js";
import type { ClaimSpawnRequestResponse } from "./proto/generated/cline/rpc/v1/ClaimSpawnRequestResponse.js";
import type { CompleteTaskRequest__Output } from "./proto/generated/cline/rpc/v1/CompleteTaskRequest.js";
import type { DeleteSessionRequest__Output } from "./proto/generated/cline/rpc/v1/DeleteSessionRequest.js";
import type { DeleteSessionResponse } from "./proto/generated/cline/rpc/v1/DeleteSessionResponse.js";
import type { EnqueueSpawnRequestRequest__Output } from "./proto/generated/cline/rpc/v1/EnqueueSpawnRequestRequest.js";
import type { EnqueueSpawnRequestResponse } from "./proto/generated/cline/rpc/v1/EnqueueSpawnRequestResponse.js";
import type { EnsureSessionRequest__Output } from "./proto/generated/cline/rpc/v1/EnsureSessionRequest.js";
import type { EnsureSessionResponse } from "./proto/generated/cline/rpc/v1/EnsureSessionResponse.js";
import type { GetSessionRequest__Output } from "./proto/generated/cline/rpc/v1/GetSessionRequest.js";
import type { GetSessionResponse } from "./proto/generated/cline/rpc/v1/GetSessionResponse.js";
import type { HealthRequest__Output } from "./proto/generated/cline/rpc/v1/HealthRequest.js";
import type { HealthResponse } from "./proto/generated/cline/rpc/v1/HealthResponse.js";
import type { ListPendingApprovalsRequest } from "./proto/generated/cline/rpc/v1/ListPendingApprovalsRequest.js";
import type { ListPendingApprovalsResponse } from "./proto/generated/cline/rpc/v1/ListPendingApprovalsResponse.js";
import type { ListSessionsRequest__Output } from "./proto/generated/cline/rpc/v1/ListSessionsRequest.js";
import type { ListSessionsResponse } from "./proto/generated/cline/rpc/v1/ListSessionsResponse.js";
import type { PendingApproval as ProtoPendingApproval } from "./proto/generated/cline/rpc/v1/PendingApproval.js";
import type { PublishEventRequest } from "./proto/generated/cline/rpc/v1/PublishEventRequest.js";
import type { PublishEventResponse } from "./proto/generated/cline/rpc/v1/PublishEventResponse.js";
import type { RegisterClientRequest__Output } from "./proto/generated/cline/rpc/v1/RegisterClientRequest.js";
import type { RegisterClientResponse } from "./proto/generated/cline/rpc/v1/RegisterClientResponse.js";
import type { RequestToolApprovalRequest__Output } from "./proto/generated/cline/rpc/v1/RequestToolApprovalRequest.js";
import type { RequestToolApprovalResponse } from "./proto/generated/cline/rpc/v1/RequestToolApprovalResponse.js";
import type { RespondToolApprovalRequest__Output } from "./proto/generated/cline/rpc/v1/RespondToolApprovalRequest.js";
import type { RespondToolApprovalResponse } from "./proto/generated/cline/rpc/v1/RespondToolApprovalResponse.js";
import type { RoutedEvent as RoutedEventMessage } from "./proto/generated/cline/rpc/v1/RoutedEvent.js";
import type { RunProviderActionRequest__Output } from "./proto/generated/cline/rpc/v1/RunProviderActionRequest.js";
import type { RunProviderActionResponse } from "./proto/generated/cline/rpc/v1/RunProviderActionResponse.js";
import type { RunProviderOAuthLoginRequest__Output } from "./proto/generated/cline/rpc/v1/RunProviderOAuthLoginRequest.js";
import type { RunProviderOAuthLoginResponse } from "./proto/generated/cline/rpc/v1/RunProviderOAuthLoginResponse.js";
import type { SendRuntimeSessionRequest__Output } from "./proto/generated/cline/rpc/v1/SendRuntimeSessionRequest.js";
import type { SendRuntimeSessionResponse } from "./proto/generated/cline/rpc/v1/SendRuntimeSessionResponse.js";
import type { SessionRecord as SessionRecordMessage } from "./proto/generated/cline/rpc/v1/SessionRecord.js";
import type { ShutdownRequest__Output } from "./proto/generated/cline/rpc/v1/ShutdownRequest.js";
import type { ShutdownResponse } from "./proto/generated/cline/rpc/v1/ShutdownResponse.js";
import type { StartRuntimeSessionRequest__Output } from "./proto/generated/cline/rpc/v1/StartRuntimeSessionRequest.js";
import type { StartRuntimeSessionResponse } from "./proto/generated/cline/rpc/v1/StartRuntimeSessionResponse.js";
import type { StartTaskRequest__Output } from "./proto/generated/cline/rpc/v1/StartTaskRequest.js";
import type { StreamEventsRequest__Output } from "./proto/generated/cline/rpc/v1/StreamEventsRequest.js";
import type { TaskResponse } from "./proto/generated/cline/rpc/v1/TaskResponse.js";
import type { UpdateSessionRequest__Output } from "./proto/generated/cline/rpc/v1/UpdateSessionRequest.js";
import type { UpdateSessionResponse } from "./proto/generated/cline/rpc/v1/UpdateSessionResponse.js";
import type { UpsertSessionRequest__Output } from "./proto/generated/cline/rpc/v1/UpsertSessionRequest.js";
import type { UpsertSessionResponse } from "./proto/generated/cline/rpc/v1/UpsertSessionResponse.js";
import type { ProtoGrpcType } from "./proto/generated/rpc.js";
import type {
	PendingApproval,
	RoutedEvent,
	RpcClientRegistrationInput,
	RpcClientRegistrationResult,
	RpcRuntimeHandlers,
	RpcServerHandle,
	RpcServerOptions,
	RpcSessionBackend,
	RpcSessionRow,
	RpcSessionStatus,
} from "./types.js";

const DEFAULT_ADDRESS = "127.0.0.1:4317";
const PACKAGE_NAME = "cline.rpc.v1";
const SERVICE_NAME = "ClineGateway";
const DEFAULT_APPROVAL_TIMEOUT_MS = 5 * 60_000;

interface SessionState {
	sessionId: string;
	status: string;
	workspaceRoot?: string;
	clientId?: string;
	metadataJson?: string;
}

interface TaskState {
	sessionId: string;
	taskId: string;
	title?: string;
	status: string;
	payloadJson?: string;
	resultJson?: string;
}

interface ApprovalState extends PendingApproval {
	status: "pending" | "approved" | "rejected";
	reason?: string;
	waiters: Array<
		(result: { decided: boolean; approved: boolean; reason?: string }) => void
	>;
}

interface StreamSubscriber {
	call: grpc.ServerWritableStream<StreamEventsRequest, RoutedEventMessage>;
	filterSessionIds: Set<string> | undefined;
}

type HealthRequest = HealthRequest__Output;
type RegisterClientRequest = RegisterClientRequest__Output;
type EnsureSessionRequest = EnsureSessionRequest__Output;
type UpsertSessionRequest = UpsertSessionRequest__Output;
type GetSessionRequest = GetSessionRequest__Output;
type ListSessionsRequest = ListSessionsRequest__Output;
type UpdateSessionRequest = UpdateSessionRequest__Output;
type DeleteSessionRequest = DeleteSessionRequest__Output;
type EnqueueSpawnRequestRequest = EnqueueSpawnRequestRequest__Output;
type ClaimSpawnRequestRequest = ClaimSpawnRequestRequest__Output;
type StartTaskRequest = StartTaskRequest__Output;
type StartRuntimeSessionRequest = StartRuntimeSessionRequest__Output;
type SendRuntimeSessionRequest = SendRuntimeSessionRequest__Output;
type RunProviderActionRequest = RunProviderActionRequest__Output;
type RunProviderOAuthLoginRequest = RunProviderOAuthLoginRequest__Output;
type CompleteTaskRequest = CompleteTaskRequest__Output;
type StreamEventsRequest = StreamEventsRequest__Output;
type ShutdownRequest = ShutdownRequest__Output;
type RequestToolApprovalRequest = RequestToolApprovalRequest__Output;
type RespondToolApprovalRequest = RespondToolApprovalRequest__Output;
type PendingApprovalMessage = ProtoPendingApproval;

function parseAddress(address: string): { host: string; port: number } {
	const trimmed = address.trim();
	const idx = trimmed.lastIndexOf(":");
	if (idx <= 0 || idx >= trimmed.length - 1) {
		throw new Error(`Invalid RPC address: ${address}`);
	}
	const host = trimmed.slice(0, idx);
	const port = Number.parseInt(trimmed.slice(idx + 1), 10);
	if (!Number.isInteger(port) || port <= 0) {
		throw new Error(`Invalid RPC port in address: ${address}`);
	}
	return { host, port };
}

function nowIso(): string {
	return new Date().toISOString();
}

function safeString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function normalizeSessionIds(
	sessionIds: string[] | undefined,
): Set<string> | undefined {
	if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
		return undefined;
	}
	const out = new Set<string>();
	for (const sessionId of sessionIds) {
		const trimmed = sessionId.trim();
		if (trimmed) {
			out.add(trimmed);
		}
	}
	return out.size > 0 ? out : undefined;
}

function resolveProtoPath(): string {
	const runtimeDir = dirname(fileURLToPath(import.meta.url));
	const candidates = [
		join(runtimeDir, "proto", "rpc.proto"),
		join(runtimeDir, "..", "src", "proto", "rpc.proto"),
		join(process.cwd(), "packages", "rpc", "src", "proto", "rpc.proto"),
	];
	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	throw new Error("Unable to resolve rpc.proto path");
}

function loadGatewayService(): grpc.ServiceDefinition {
	const packageDef = protoLoader.loadSync(resolveProtoPath(), {
		keepCase: false,
		longs: String,
		enums: String,
		defaults: true,
		oneofs: true,
	});
	const loaded = grpc.loadPackageDefinition(
		packageDef,
	) as unknown as ProtoGrpcType;
	const service = loaded.cline?.rpc?.v1?.ClineGateway?.service;
	if (!service) {
		throw new Error(
			`Unable to load ${PACKAGE_NAME}.${SERVICE_NAME} from proto`,
		);
	}
	return service;
}

function normalizeStatus(value: string): RpcSessionStatus {
	if (
		value === "running" ||
		value === "completed" ||
		value === "failed" ||
		value === "cancelled"
	) {
		return value;
	}
	return "running";
}

function rowToMessage(row: RpcSessionRow): SessionRecordMessage {
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

function messageToRow(message: SessionRecordMessage): RpcSessionRow {
	const sessionId = safeString(message.sessionId).trim();
	const source = safeString(message.source).trim();
	const startedAt = safeString(message.startedAt).trim();
	const provider = safeString(message.provider).trim();
	const model = safeString(message.model).trim();
	const cwd = safeString(message.cwd).trim();
	const workspaceRoot = safeString(message.workspaceRoot).trim();
	const transcriptPath = safeString(message.transcriptPath).trim();
	const hookPath = safeString(message.hookPath).trim();
	if (
		!sessionId ||
		!source ||
		!startedAt ||
		!provider ||
		!model ||
		!cwd ||
		!workspaceRoot ||
		!transcriptPath ||
		!hookPath
	) {
		throw new Error("session record is missing required fields");
	}
	return {
		sessionId,
		source,
		pid: Number(message.pid ?? 0),
		startedAt,
		endedAt: safeString(message.endedAt).trim() || null,
		exitCode:
			typeof message.exitCode === "number"
				? Math.floor(message.exitCode)
				: null,
		status: normalizeStatus(safeString(message.status).trim()),
		statusLock:
			typeof message.statusLock === "number"
				? Math.floor(message.statusLock)
				: 0,
		interactive: message.interactive === true,
		provider,
		model,
		cwd,
		workspaceRoot,
		teamName: safeString(message.teamName).trim() || undefined,
		enableTools: message.enableTools === true,
		enableSpawn: message.enableSpawn === true,
		enableTeams: message.enableTeams === true,
		parentSessionId: safeString(message.parentSessionId).trim() || undefined,
		parentAgentId: safeString(message.parentAgentId).trim() || undefined,
		agentId: safeString(message.agentId).trim() || undefined,
		conversationId: safeString(message.conversationId).trim() || undefined,
		isSubagent: message.isSubagent === true,
		prompt: safeString(message.prompt).trim() || undefined,
		transcriptPath,
		hookPath,
		messagesPath: safeString(message.messagesPath).trim() || undefined,
		updatedAt: safeString(message.updatedAt).trim() || nowIso(),
	};
}

class ClineGatewayRuntime {
	private readonly serverId = randomUUID();
	private readonly address: string;
	private readonly startedAt: string;
	private readonly runtimeHandlers?: RpcRuntimeHandlers;
	private readonly sessions = new Map<string, SessionState>();
	private readonly tasks = new Map<string, TaskState>();
	private readonly approvals = new Map<string, ApprovalState>();
	private readonly subscribers = new Map<number, StreamSubscriber>();
	private readonly store: RpcSessionBackend;
	private nextSubscriberId = 1;

	constructor(
		address: string,
		sessionBackend: RpcSessionBackend,
		runtimeHandlers?: RpcRuntimeHandlers,
	) {
		this.address = address;
		this.startedAt = nowIso();
		this.store = sessionBackend;
		this.runtimeHandlers = runtimeHandlers;
		this.store.init();
	}

	public health(): HealthResponse {
		return {
			serverId: this.serverId,
			address: this.address,
			running: true,
			startedAt: this.startedAt,
		};
	}

	public registerClient(
		request: RegisterClientRequest,
	): RegisterClientResponse {
		const requested = safeString(request.clientId).trim();
		const clientId = requested || `client_${randomUUID()}`;
		return { clientId, registered: true };
	}

	public ensureSession(request: EnsureSessionRequest): EnsureSessionResponse {
		const sessionId = safeString(request.sessionId).trim();
		if (!sessionId) {
			throw new Error("sessionId is required");
		}
		const existing = this.sessions.get(sessionId);
		if (existing) {
			existing.status = safeString(request.status).trim() || existing.status;
			existing.workspaceRoot =
				safeString(request.workspaceRoot).trim() || existing.workspaceRoot;
			existing.clientId =
				safeString(request.clientId).trim() || existing.clientId;
			existing.metadataJson =
				safeString(request.metadataJson).trim() || existing.metadataJson;
			return { sessionId, created: false, status: existing.status };
		}
		const status = safeString(request.status).trim() || "running";
		this.sessions.set(sessionId, {
			sessionId,
			status,
			workspaceRoot: safeString(request.workspaceRoot).trim() || undefined,
			clientId: safeString(request.clientId).trim() || undefined,
			metadataJson: safeString(request.metadataJson).trim() || undefined,
		});
		return { sessionId, created: true, status };
	}

	public upsertSession(request: UpsertSessionRequest): UpsertSessionResponse {
		if (!request.session) {
			throw new Error("session is required");
		}
		this.store.upsertSession(messageToRow(request.session));
		return { persisted: true };
	}

	public getSession(request: GetSessionRequest): GetSessionResponse {
		const sessionId = safeString(request.sessionId).trim();
		if (!sessionId) {
			throw new Error("sessionId is required");
		}
		const row = this.store.getSession(sessionId);
		if (!row) {
			return {};
		}
		return { session: rowToMessage(row) };
	}

	public listSessions(request: ListSessionsRequest): ListSessionsResponse {
		const limit =
			typeof request.limit === "number" && request.limit > 0
				? Math.floor(request.limit)
				: 200;
		const rows = this.store.listSessions({
			limit,
			parentSessionId: safeString(request.parentSessionId).trim() || undefined,
			status: safeString(request.status).trim() || undefined,
		});
		return { sessions: rows.map((row) => rowToMessage(row)) };
	}

	public updateSession(request: UpdateSessionRequest): UpdateSessionResponse {
		const sessionId = safeString(request.sessionId).trim();
		if (!sessionId) {
			throw new Error("sessionId is required");
		}
		const result = this.store.updateSession({
			sessionId,
			status: request.status ? normalizeStatus(request.status) : undefined,
			endedAt: request.endedAt ? request.endedAt : undefined,
			exitCode: request.hasExitCode ? (request.exitCode ?? null) : undefined,
			prompt: request.hasPrompt ? (request.prompt ?? null) : undefined,
			parentSessionId: request.hasParentSessionId
				? (request.parentSessionId ?? null)
				: undefined,
			parentAgentId: request.hasParentAgentId
				? (request.parentAgentId ?? null)
				: undefined,
			agentId: request.hasAgentId ? (request.agentId ?? null) : undefined,
			conversationId: request.hasConversationId
				? (request.conversationId ?? null)
				: undefined,
			expectedStatusLock: request.hasExpectedStatusLock
				? request.expectedStatusLock
				: undefined,
			setRunning: request.setRunning === true,
		});
		return result;
	}

	public deleteSession(request: DeleteSessionRequest): DeleteSessionResponse {
		const sessionId = safeString(request.sessionId).trim();
		if (!sessionId) {
			throw new Error("sessionId is required");
		}
		const deleted = this.store.deleteSession(sessionId);
		if (request.cascade === true) {
			this.store.deleteSessionsByParent(sessionId);
		}
		return { deleted };
	}

	public enqueueSpawnRequest(
		request: EnqueueSpawnRequestRequest,
	): EnqueueSpawnRequestResponse {
		const rootSessionId = safeString(request.rootSessionId).trim();
		const parentAgentId = safeString(request.parentAgentId).trim();
		if (!rootSessionId || !parentAgentId) {
			throw new Error("rootSessionId and parentAgentId are required");
		}
		this.store.enqueueSpawnRequest({
			rootSessionId,
			parentAgentId,
			task: safeString(request.task).trim() || undefined,
			systemPrompt: safeString(request.systemPrompt).trim() || undefined,
		});
		return { enqueued: true };
	}

	public claimSpawnRequest(
		request: ClaimSpawnRequestRequest,
	): ClaimSpawnRequestResponse {
		const rootSessionId = safeString(request.rootSessionId).trim();
		const parentAgentId = safeString(request.parentAgentId).trim();
		if (!rootSessionId || !parentAgentId) {
			throw new Error("rootSessionId and parentAgentId are required");
		}
		const item = this.store.claimSpawnRequest(rootSessionId, parentAgentId);
		if (!item) {
			return {};
		}
		return {
			item: {
				id: String(item.id),
				rootSessionId: item.rootSessionId,
				parentAgentId: item.parentAgentId,
				task: item.task ?? "",
				systemPrompt: item.systemPrompt ?? "",
				createdAt: item.createdAt,
				consumedAt: item.consumedAt ?? "",
			},
		};
	}

	public async startRuntimeSession(
		request: StartRuntimeSessionRequest,
	): Promise<StartRuntimeSessionResponse> {
		const handler = this.runtimeHandlers?.startSession;
		if (!handler) {
			throw new Error("runtime start handler is not configured");
		}
		const payload = safeString(request.requestJson);
		const result = await handler(payload);
		const sessionId = safeString(result.sessionId).trim();
		if (!sessionId) {
			throw new Error("runtime start handler returned empty sessionId");
		}
		return { sessionId };
	}

	public async sendRuntimeSession(
		request: SendRuntimeSessionRequest,
	): Promise<SendRuntimeSessionResponse> {
		const handler = this.runtimeHandlers?.sendSession;
		if (!handler) {
			throw new Error("runtime send handler is not configured");
		}
		const sessionId = safeString(request.sessionId).trim();
		if (!sessionId) {
			throw new Error("sessionId is required");
		}
		const payload = safeString(request.requestJson);
		const result = await handler(sessionId, payload);
		return { resultJson: safeString(result.resultJson) };
	}

	public async runProviderAction(
		request: RunProviderActionRequest,
	): Promise<RunProviderActionResponse> {
		const handler = this.runtimeHandlers?.runProviderAction;
		if (!handler) {
			throw new Error("provider action handler is not configured");
		}
		const payload = safeString(request.requestJson);
		const result = await handler(payload);
		return { resultJson: safeString(result.resultJson) };
	}

	public async runProviderOAuthLogin(
		request: RunProviderOAuthLoginRequest,
	): Promise<RunProviderOAuthLoginResponse> {
		const handler = this.runtimeHandlers?.runProviderOAuthLogin;
		if (!handler) {
			throw new Error("provider oauth handler is not configured");
		}
		const provider = safeString(request.provider).trim();
		if (!provider) {
			throw new Error("provider is required");
		}
		const result = await handler(provider);
		return {
			provider: safeString(result.provider).trim(),
			apiKey: safeString(result.apiKey),
		};
	}

	public startTask(request: StartTaskRequest): TaskResponse {
		const sessionId = safeString(request.sessionId).trim();
		const taskId = safeString(request.taskId).trim();
		if (!sessionId || !taskId) {
			throw new Error("sessionId and taskId are required");
		}
		const key = `${sessionId}:${taskId}`;
		this.tasks.set(key, {
			sessionId,
			taskId,
			title: safeString(request.title).trim() || undefined,
			status: "running",
			payloadJson: safeString(request.payloadJson).trim() || undefined,
		});
		this.publishEvent({
			eventId: "",
			sessionId,
			taskId,
			eventType: "task.started",
			payloadJson: safeString(request.payloadJson),
			sourceClientId: "",
		});
		return { sessionId, taskId, status: "running", updated: true };
	}

	public completeTask(request: CompleteTaskRequest): TaskResponse {
		const sessionId = safeString(request.sessionId).trim();
		const taskId = safeString(request.taskId).trim();
		if (!sessionId || !taskId) {
			throw new Error("sessionId and taskId are required");
		}
		const key = `${sessionId}:${taskId}`;
		const nextStatus = safeString(request.status).trim() || "completed";
		const existing = this.tasks.get(key);
		if (!existing) {
			return { sessionId, taskId, status: nextStatus, updated: false };
		}
		existing.status = nextStatus;
		existing.resultJson = safeString(request.resultJson).trim() || undefined;
		this.publishEvent({
			eventId: "",
			sessionId,
			taskId,
			eventType: "task.completed",
			payloadJson: safeString(request.resultJson),
			sourceClientId: "",
		});
		return { sessionId, taskId, status: nextStatus, updated: true };
	}

	public publishEvent(request: PublishEventRequest): PublishEventResponse {
		const sessionId = safeString(request.sessionId).trim();
		if (!sessionId) {
			throw new Error("sessionId is required");
		}
		const event: RoutedEvent = {
			eventId: safeString(request.eventId).trim() || `evt_${randomUUID()}`,
			sessionId,
			taskId: safeString(request.taskId).trim() || undefined,
			eventType: safeString(request.eventType).trim() || "unknown",
			payloadJson: safeString(request.payloadJson),
			sourceClientId: safeString(request.sourceClientId).trim() || undefined,
			ts: nowIso(),
		};
		this.dispatchEvent(event);
		return { eventId: event.eventId, accepted: true };
	}

	public addSubscriber(
		call: grpc.ServerWritableStream<StreamEventsRequest, RoutedEventMessage>,
	): number {
		const request = call.request;
		const filterSessionIds = normalizeSessionIds(request.sessionIds);
		const subscriberId = this.nextSubscriberId;
		this.nextSubscriberId += 1;
		this.subscribers.set(subscriberId, { call, filterSessionIds });
		call.on("cancelled", () => {
			this.subscribers.delete(subscriberId);
		});
		call.on("close", () => {
			this.subscribers.delete(subscriberId);
		});
		return subscriberId;
	}

	public removeSubscriber(subscriberId: number): void {
		this.subscribers.delete(subscriberId);
	}

	public async requestToolApproval(
		request: RequestToolApprovalRequest,
	): Promise<RequestToolApprovalResponse> {
		const sessionId = safeString(request.sessionId).trim();
		const toolCallId = safeString(request.toolCallId).trim();
		const toolName = safeString(request.toolName).trim();
		if (!sessionId || !toolCallId || !toolName) {
			throw new Error("sessionId, toolCallId, and toolName are required");
		}

		const approvalId =
			safeString(request.approvalId).trim() || `apr_${randomUUID()}`;
		const existing = this.approvals.get(approvalId);
		if (!existing) {
			const state: ApprovalState = {
				approvalId,
				sessionId,
				taskId: safeString(request.taskId).trim() || undefined,
				toolCallId,
				toolName,
				inputJson: safeString(request.inputJson),
				requesterClientId:
					safeString(request.requesterClientId).trim() || undefined,
				createdAt: nowIso(),
				status: "pending",
				waiters: [],
			};
			this.approvals.set(approvalId, state);
			this.publishEvent({
				eventId: "",
				sessionId,
				taskId: state.taskId,
				eventType: "approval.requested",
				payloadJson: JSON.stringify(state),
				sourceClientId: state.requesterClientId,
			});
		}

		const approval = this.approvals.get(approvalId);
		if (!approval) {
			throw new Error("approval state not found");
		}
		if (approval.status === "approved" || approval.status === "rejected") {
			return {
				approvalId,
				decided: true,
				approved: approval.status === "approved",
				reason: approval.reason ?? "",
			};
		}

		const timeoutMs =
			typeof request.timeoutMs === "number" && request.timeoutMs > 0
				? Math.floor(request.timeoutMs)
				: DEFAULT_APPROVAL_TIMEOUT_MS;

		const result = await new Promise<{
			decided: boolean;
			approved: boolean;
			reason?: string;
		}>((resolve) => {
			const timeout = setTimeout(() => {
				resolve({
					decided: false,
					approved: false,
					reason: "Tool approval request timed out",
				});
			}, timeoutMs);
			approval.waiters.push((value) => {
				clearTimeout(timeout);
				resolve(value);
			});
		});

		return {
			approvalId,
			decided: result.decided,
			approved: result.approved,
			reason: result.reason ?? "",
		};
	}

	public respondToolApproval(
		request: RespondToolApprovalRequest,
	): RespondToolApprovalResponse {
		const approvalId = safeString(request.approvalId).trim();
		if (!approvalId) {
			throw new Error("approvalId is required");
		}
		const approval = this.approvals.get(approvalId);
		if (!approval) {
			return { approvalId, applied: false };
		}
		approval.status = request.approved === true ? "approved" : "rejected";
		approval.reason = safeString(request.reason).trim() || undefined;
		const decided = {
			decided: true,
			approved: approval.status === "approved",
			reason: approval.reason,
		};
		for (const waiter of approval.waiters.splice(0)) {
			waiter(decided);
		}
		this.publishEvent({
			eventId: "",
			sessionId: approval.sessionId,
			taskId: approval.taskId,
			eventType: "approval.decided",
			payloadJson: JSON.stringify({
				approvalId,
				approved: decided.approved,
				reason: decided.reason ?? "",
				responderClientId: safeString(request.responderClientId).trim() || "",
			}),
			sourceClientId: safeString(request.responderClientId).trim() || "",
		});
		return { approvalId, applied: true };
	}

	public listPendingApprovals(
		request: ListPendingApprovalsRequest,
	): ListPendingApprovalsResponse {
		const sessionFilter = safeString(request.sessionId).trim();
		const approvals: PendingApprovalMessage[] = [];
		for (const approval of this.approvals.values()) {
			if (approval.status !== "pending") {
				continue;
			}
			if (sessionFilter && approval.sessionId !== sessionFilter) {
				continue;
			}
			approvals.push({
				approvalId: approval.approvalId,
				sessionId: approval.sessionId,
				taskId: approval.taskId ?? "",
				toolCallId: approval.toolCallId,
				toolName: approval.toolName,
				inputJson: approval.inputJson,
				requesterClientId: approval.requesterClientId ?? "",
				createdAt: approval.createdAt,
			});
		}
		approvals.sort((a, b) =>
			(a.createdAt ?? "").localeCompare(b.createdAt ?? ""),
		);
		return { approvals };
	}

	private dispatchEvent(event: RoutedEvent): void {
		for (const subscriber of this.subscribers.values()) {
			if (
				subscriber.filterSessionIds &&
				!subscriber.filterSessionIds.has(event.sessionId)
			) {
				continue;
			}
			subscriber.call.write({
				eventId: event.eventId,
				sessionId: event.sessionId,
				taskId: event.taskId ?? "",
				eventType: event.eventType,
				payloadJson: event.payloadJson,
				sourceClientId: event.sourceClientId ?? "",
				ts: event.ts,
			});
		}
	}
}

let singletonHandle: RpcServerHandle | undefined;
let singletonStartPromise: Promise<RpcServerHandle> | undefined;

type ClineGatewayHealthClient = grpc.Client & {
	Health: (
		request: HealthRequest,
		callback: (
			error: grpc.ServiceError | null,
			response: HealthResponse | undefined,
		) => void,
	) => void;
	Shutdown: (
		request: ShutdownRequest,
		callback: (
			error: grpc.ServiceError | null,
			response: ShutdownResponse | undefined,
		) => void,
	) => void;
	RegisterClient: (
		request: {
			clientId?: string;
			clientType?: string;
			metadata?: Record<string, string>;
		},
		callback: (
			error: grpc.ServiceError | null,
			response: RegisterClientResponse | undefined,
		) => void,
	) => void;
};

function createGatewayClient(address: string): ClineGatewayHealthClient {
	const ctor = grpc.makeGenericClientConstructor(
		loadGatewayService(),
		SERVICE_NAME,
	) as unknown as new (
		address: string,
		credentials: grpc.ChannelCredentials,
	) => ClineGatewayHealthClient;
	return new ctor(address, grpc.credentials.createInsecure());
}

export async function getRpcServerHealth(
	address: string,
): Promise<HealthResponse | undefined> {
	return await new Promise<HealthResponse | undefined>((resolve) => {
		let client: ClineGatewayHealthClient | undefined;
		try {
			client = createGatewayClient(address);
		} catch {
			resolve(undefined);
			return;
		}
		client.Health({}, (error, response) => {
			client?.close();
			if (error || !response) {
				resolve(undefined);
				return;
			}
			resolve(response);
		});
	});
}

export async function requestRpcServerShutdown(
	address: string,
): Promise<ShutdownResponse | undefined> {
	return await new Promise<ShutdownResponse | undefined>((resolve) => {
		let client: ClineGatewayHealthClient | undefined;
		try {
			client = createGatewayClient(address);
		} catch {
			resolve(undefined);
			return;
		}
		client.Shutdown({}, (error, response) => {
			client?.close();
			if (error || !response) {
				resolve(undefined);
				return;
			}
			resolve(response);
		});
	});
}

export async function registerRpcClient(
	address: string,
	input: RpcClientRegistrationInput,
): Promise<RpcClientRegistrationResult | undefined> {
	return await new Promise<RpcClientRegistrationResult | undefined>(
		(resolve) => {
			let client: ClineGatewayHealthClient | undefined;
			try {
				client = createGatewayClient(address);
			} catch {
				resolve(undefined);
				return;
			}
			client.RegisterClient(
				{
					clientId: input.clientId,
					clientType: input.clientType,
					metadata: input.metadata ?? {},
				},
				(error, response) => {
					client?.close();
					if (error || !response) {
						resolve(undefined);
						return;
					}
					resolve({
						clientId: safeString(response.clientId).trim(),
						registered: response.registered === true,
					});
				},
			);
		},
	);
}

export async function startRpcServer(
	options: RpcServerOptions,
): Promise<RpcServerHandle> {
	if (singletonHandle) {
		return singletonHandle;
	}
	if (singletonStartPromise) {
		return singletonStartPromise;
	}

	singletonStartPromise = new Promise<RpcServerHandle>((resolve, reject) => {
		const address = options.address?.trim() || DEFAULT_ADDRESS;
		try {
			parseAddress(address);
		} catch (error) {
			singletonStartPromise = undefined;
			reject(error instanceof Error ? error : new Error(String(error)));
			return;
		}
		if (!options.sessionBackend) {
			singletonStartPromise = undefined;
			reject(new Error("startRpcServer requires options.sessionBackend"));
			return;
		}

		const runtime = new ClineGatewayRuntime(
			address,
			options.sessionBackend,
			options.runtimeHandlers,
		);
		const server = new grpc.Server();
		let stopRequested = false;
		const stopBoundServer = async (): Promise<void> => {
			if (stopRequested) {
				return;
			}
			stopRequested = true;
			await new Promise<void>((resolveShutdown) => {
				server.tryShutdown(() => {
					resolveShutdown();
				});
			});
			singletonHandle = undefined;
			singletonStartPromise = undefined;
		};
		server.addService(loadGatewayService(), {
			Health: (
				call: grpc.ServerUnaryCall<HealthRequest, HealthResponse>,
				callback: grpc.sendUnaryData<HealthResponse>,
			) => {
				void call;
				callback(null, runtime.health());
			},
			Shutdown: (
				call: grpc.ServerUnaryCall<ShutdownRequest, ShutdownResponse>,
				callback: grpc.sendUnaryData<ShutdownResponse>,
			) => {
				void call;
				callback(null, { accepted: true });
				setImmediate(() => {
					void stopBoundServer();
				});
			},
			RegisterClient: (
				call: grpc.ServerUnaryCall<
					RegisterClientRequest,
					RegisterClientResponse
				>,
				callback: grpc.sendUnaryData<RegisterClientResponse>,
			) => {
				try {
					callback(null, runtime.registerClient(call.request));
				} catch (error) {
					callback(
						{ code: grpc.status.INVALID_ARGUMENT, message: String(error) },
						null,
					);
				}
			},
			EnsureSession: (
				call: grpc.ServerUnaryCall<EnsureSessionRequest, EnsureSessionResponse>,
				callback: grpc.sendUnaryData<EnsureSessionResponse>,
			) => {
				try {
					callback(null, runtime.ensureSession(call.request));
				} catch (error) {
					callback(
						{ code: grpc.status.INVALID_ARGUMENT, message: String(error) },
						null,
					);
				}
			},
			UpsertSession: (
				call: grpc.ServerUnaryCall<UpsertSessionRequest, UpsertSessionResponse>,
				callback: grpc.sendUnaryData<UpsertSessionResponse>,
			) => {
				try {
					callback(null, runtime.upsertSession(call.request));
				} catch (error) {
					callback(
						{ code: grpc.status.INVALID_ARGUMENT, message: String(error) },
						null,
					);
				}
			},
			GetSession: (
				call: grpc.ServerUnaryCall<GetSessionRequest, GetSessionResponse>,
				callback: grpc.sendUnaryData<GetSessionResponse>,
			) => {
				try {
					callback(null, runtime.getSession(call.request));
				} catch (error) {
					callback(
						{ code: grpc.status.INVALID_ARGUMENT, message: String(error) },
						null,
					);
				}
			},
			ListSessions: (
				call: grpc.ServerUnaryCall<ListSessionsRequest, ListSessionsResponse>,
				callback: grpc.sendUnaryData<ListSessionsResponse>,
			) => {
				try {
					callback(null, runtime.listSessions(call.request));
				} catch (error) {
					callback(
						{ code: grpc.status.INVALID_ARGUMENT, message: String(error) },
						null,
					);
				}
			},
			UpdateSession: (
				call: grpc.ServerUnaryCall<UpdateSessionRequest, UpdateSessionResponse>,
				callback: grpc.sendUnaryData<UpdateSessionResponse>,
			) => {
				try {
					callback(null, runtime.updateSession(call.request));
				} catch (error) {
					callback(
						{ code: grpc.status.INVALID_ARGUMENT, message: String(error) },
						null,
					);
				}
			},
			DeleteSession: (
				call: grpc.ServerUnaryCall<DeleteSessionRequest, DeleteSessionResponse>,
				callback: grpc.sendUnaryData<DeleteSessionResponse>,
			) => {
				try {
					callback(null, runtime.deleteSession(call.request));
				} catch (error) {
					callback(
						{ code: grpc.status.INVALID_ARGUMENT, message: String(error) },
						null,
					);
				}
			},
			EnqueueSpawnRequest: (
				call: grpc.ServerUnaryCall<
					EnqueueSpawnRequestRequest,
					EnqueueSpawnRequestResponse
				>,
				callback: grpc.sendUnaryData<EnqueueSpawnRequestResponse>,
			) => {
				try {
					callback(null, runtime.enqueueSpawnRequest(call.request));
				} catch (error) {
					callback(
						{ code: grpc.status.INVALID_ARGUMENT, message: String(error) },
						null,
					);
				}
			},
			ClaimSpawnRequest: (
				call: grpc.ServerUnaryCall<
					ClaimSpawnRequestRequest,
					ClaimSpawnRequestResponse
				>,
				callback: grpc.sendUnaryData<ClaimSpawnRequestResponse>,
			) => {
				try {
					callback(null, runtime.claimSpawnRequest(call.request));
				} catch (error) {
					callback(
						{ code: grpc.status.INVALID_ARGUMENT, message: String(error) },
						null,
					);
				}
			},
			StartRuntimeSession: (
				call: grpc.ServerUnaryCall<
					StartRuntimeSessionRequest,
					StartRuntimeSessionResponse
				>,
				callback: grpc.sendUnaryData<StartRuntimeSessionResponse>,
			) => {
				void runtime
					.startRuntimeSession(call.request)
					.then((result) => {
						callback(null, result);
					})
					.catch((error) => {
						callback(
							{ code: grpc.status.INVALID_ARGUMENT, message: String(error) },
							null,
						);
					});
			},
			SendRuntimeSession: (
				call: grpc.ServerUnaryCall<
					SendRuntimeSessionRequest,
					SendRuntimeSessionResponse
				>,
				callback: grpc.sendUnaryData<SendRuntimeSessionResponse>,
			) => {
				void runtime
					.sendRuntimeSession(call.request)
					.then((result) => {
						callback(null, result);
					})
					.catch((error) => {
						callback(
							{ code: grpc.status.INVALID_ARGUMENT, message: String(error) },
							null,
						);
					});
			},
			RunProviderAction: (
				call: grpc.ServerUnaryCall<
					RunProviderActionRequest,
					RunProviderActionResponse
				>,
				callback: grpc.sendUnaryData<RunProviderActionResponse>,
			) => {
				void runtime
					.runProviderAction(call.request)
					.then((result) => {
						callback(null, result);
					})
					.catch((error) => {
						callback(
							{ code: grpc.status.INVALID_ARGUMENT, message: String(error) },
							null,
						);
					});
			},
			RunProviderOAuthLogin: (
				call: grpc.ServerUnaryCall<
					RunProviderOAuthLoginRequest,
					RunProviderOAuthLoginResponse
				>,
				callback: grpc.sendUnaryData<RunProviderOAuthLoginResponse>,
			) => {
				void runtime
					.runProviderOAuthLogin(call.request)
					.then((result) => {
						callback(null, result);
					})
					.catch((error) => {
						callback(
							{ code: grpc.status.INVALID_ARGUMENT, message: String(error) },
							null,
						);
					});
			},
			StartTask: (
				call: grpc.ServerUnaryCall<StartTaskRequest, TaskResponse>,
				callback: grpc.sendUnaryData<TaskResponse>,
			) => {
				try {
					callback(null, runtime.startTask(call.request));
				} catch (error) {
					callback(
						{ code: grpc.status.INVALID_ARGUMENT, message: String(error) },
						null,
					);
				}
			},
			CompleteTask: (
				call: grpc.ServerUnaryCall<CompleteTaskRequest, TaskResponse>,
				callback: grpc.sendUnaryData<TaskResponse>,
			) => {
				try {
					callback(null, runtime.completeTask(call.request));
				} catch (error) {
					callback(
						{ code: grpc.status.INVALID_ARGUMENT, message: String(error) },
						null,
					);
				}
			},
			PublishEvent: (
				call: grpc.ServerUnaryCall<PublishEventRequest, PublishEventResponse>,
				callback: grpc.sendUnaryData<PublishEventResponse>,
			) => {
				try {
					callback(null, runtime.publishEvent(call.request));
				} catch (error) {
					callback(
						{ code: grpc.status.INVALID_ARGUMENT, message: String(error) },
						null,
					);
				}
			},
			StreamEvents: (
				call: grpc.ServerWritableStream<
					StreamEventsRequest,
					RoutedEventMessage
				>,
			) => {
				const subscriberId = runtime.addSubscriber(call);
				call.on("error", () => {
					runtime.removeSubscriber(subscriberId);
				});
			},
			RequestToolApproval: (
				call: grpc.ServerUnaryCall<
					RequestToolApprovalRequest,
					RequestToolApprovalResponse
				>,
				callback: grpc.sendUnaryData<RequestToolApprovalResponse>,
			) => {
				void runtime
					.requestToolApproval(call.request)
					.then((result) => {
						callback(null, result);
					})
					.catch((error) => {
						callback(
							{ code: grpc.status.INVALID_ARGUMENT, message: String(error) },
							null,
						);
					});
			},
			RespondToolApproval: (
				call: grpc.ServerUnaryCall<
					RespondToolApprovalRequest,
					RespondToolApprovalResponse
				>,
				callback: grpc.sendUnaryData<RespondToolApprovalResponse>,
			) => {
				try {
					callback(null, runtime.respondToolApproval(call.request));
				} catch (error) {
					callback(
						{ code: grpc.status.INVALID_ARGUMENT, message: String(error) },
						null,
					);
				}
			},
			ListPendingApprovals: (
				call: grpc.ServerUnaryCall<
					ListPendingApprovalsRequest,
					ListPendingApprovalsResponse
				>,
				callback: grpc.sendUnaryData<ListPendingApprovalsResponse>,
			) => {
				try {
					callback(null, runtime.listPendingApprovals(call.request));
				} catch (error) {
					callback(
						{ code: grpc.status.INVALID_ARGUMENT, message: String(error) },
						null,
					);
				}
			},
		});

		server.bindAsync(
			address,
			grpc.ServerCredentials.createInsecure(),
			(error, boundPort) => {
				if (error) {
					singletonStartPromise = undefined;
					reject(error);
					return;
				}

				const serverId = runtime.health().serverId ?? `srv_${randomUUID()}`;
				const startedAt = nowIso();
				const handle: RpcServerHandle = {
					serverId,
					address,
					port: boundPort,
					startedAt,
					stop: stopBoundServer,
				};
				singletonHandle = handle;
				resolve(handle);
			},
		);
	});

	return singletonStartPromise;
}

export function getRpcServerHandle(): RpcServerHandle | undefined {
	return singletonHandle;
}

export async function stopRpcServer(): Promise<void> {
	if (singletonHandle) {
		await singletonHandle.stop();
	}
}
