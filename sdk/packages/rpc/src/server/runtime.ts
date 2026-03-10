import { randomUUID } from "node:crypto";
import type { SchedulerService } from "@cline/scheduler";
import type * as grpc from "@grpc/grpc-js";
import type { RpcRuntimeHandlers, RpcSessionBackend } from "../types.js";
import {
	messageToRow,
	normalizeMetadataMap,
	normalizeStatus,
	nowIso,
	rowToMessage,
	safeString,
} from "./helpers.js";
import type {
	AbortRuntimeSessionRequest,
	AbortRuntimeSessionResponse,
	ClaimSpawnRequestRequest,
	ClaimSpawnRequestResponse,
	CompleteTaskRequest,
	CreateScheduleRequest,
	CreateScheduleResponse,
	DeleteScheduleRequest,
	DeleteScheduleResponse,
	DeleteSessionRequest,
	DeleteSessionResponse,
	EnqueueSpawnRequestRequest,
	EnqueueSpawnRequestResponse,
	EnsureSessionRequest,
	EnsureSessionResponse,
	GetActiveScheduledExecutionsRequest,
	GetActiveScheduledExecutionsResponse,
	GetScheduleRequest,
	GetScheduleResponse,
	GetScheduleStatsRequest,
	GetScheduleStatsResponse,
	GetSessionRequest,
	GetSessionResponse,
	GetUpcomingScheduledRunsRequest,
	GetUpcomingScheduledRunsResponse,
	HealthResponse,
	ListPendingApprovalsRequest,
	ListPendingApprovalsResponse,
	ListScheduleExecutionsRequest,
	ListScheduleExecutionsResponse,
	ListSchedulesRequest,
	ListSchedulesResponse,
	ListSessionsRequest,
	ListSessionsResponse,
	PauseScheduleRequest,
	PauseScheduleResponse,
	PublishEventRequest,
	PublishEventResponse,
	RegisterClientRequest,
	RegisterClientResponse,
	RequestToolApprovalRequest,
	RequestToolApprovalResponse,
	RespondToolApprovalRequest,
	RespondToolApprovalResponse,
	ResumeScheduleRequest,
	ResumeScheduleResponse,
	RoutedEventMessage,
	RunProviderActionRequest,
	RunProviderActionResponse,
	RunProviderOAuthLoginRequest,
	RunProviderOAuthLoginResponse,
	SendRuntimeSessionRequest,
	SendRuntimeSessionResponse,
	StartRuntimeSessionRequest,
	StartRuntimeSessionResponse,
	StartTaskRequest,
	StopRuntimeSessionRequest,
	StopRuntimeSessionResponse,
	StreamEventsRequest,
	TaskResponse,
	TriggerScheduleNowRequest,
	TriggerScheduleNowResponse,
	UpdateScheduleRequest,
	UpdateScheduleResponse,
	UpdateSessionRequest,
	UpdateSessionResponse,
	UpsertSessionRequest,
	UpsertSessionResponse,
} from "./proto-types.js";
import { RuntimeApprovalService } from "./runtime-approvals.js";
import { RuntimeEventService } from "./runtime-events.js";
import { RuntimeScheduleService } from "./runtime-schedules.js";

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

interface RegisteredClientState {
	clientId: string;
	clientType?: string;
	metadata?: Record<string, string>;
	firstRegisteredAt: string;
	lastRegisteredAt: string;
	activationCount: number;
}

export class ClineGatewayRuntime {
	private readonly serverId = randomUUID();
	private readonly address: string;
	private readonly startedAt: string;
	private readonly runtimeHandlers?: RpcRuntimeHandlers;
	private readonly sessions = new Map<string, SessionState>();
	private readonly tasks = new Map<string, TaskState>();
	private readonly clients = new Map<string, RegisteredClientState>();
	private readonly store: RpcSessionBackend;
	private readonly eventService = new RuntimeEventService();
	private readonly approvalService = new RuntimeApprovalService((request) =>
		this.eventService.publishEvent(request),
	);
	private readonly scheduleService: RuntimeScheduleService;

	constructor(
		address: string,
		sessionBackend: RpcSessionBackend,
		runtimeHandlers?: RpcRuntimeHandlers,
		scheduler?: SchedulerService,
	) {
		this.address = address;
		this.startedAt = nowIso();
		this.store = sessionBackend;
		this.runtimeHandlers = runtimeHandlers;
		this.scheduleService = new RuntimeScheduleService(scheduler);
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
		const clientType = safeString(request.clientType).trim() || undefined;
		const metadata = normalizeMetadataMap(
			request as unknown as { metadata?: unknown },
		);
		const now = nowIso();
		const existing = this.clients.get(clientId);
		const nextState: RegisteredClientState = existing
			? {
					...existing,
					clientType: clientType ?? existing.clientType,
					metadata:
						Object.keys(metadata).length > 0
							? { ...(existing.metadata ?? {}), ...metadata }
							: existing.metadata,
					lastRegisteredAt: now,
					activationCount: existing.activationCount + 1,
				}
			: {
					clientId,
					clientType,
					metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
					firstRegisteredAt: now,
					lastRegisteredAt: now,
					activationCount: 1,
				};
		this.clients.set(clientId, nextState);
		this.broadcastServerEvent("rpc.client.activated", {
			clientId: nextState.clientId,
			clientType: nextState.clientType,
			metadata: nextState.metadata ?? {},
			firstRegisteredAt: nextState.firstRegisteredAt,
			lastRegisteredAt: nextState.lastRegisteredAt,
			activationCount: nextState.activationCount,
		});
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
		return this.store.updateSession({
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
		return {
			sessionId,
			startResultJson: safeString(result.startResultJson),
		};
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

	public async stopRuntimeSession(
		request: StopRuntimeSessionRequest,
	): Promise<StopRuntimeSessionResponse> {
		const handler = this.runtimeHandlers?.stopSession;
		if (!handler) {
			throw new Error("runtime stop handler is not configured");
		}
		const sessionId = safeString(request.sessionId).trim();
		if (!sessionId) {
			throw new Error("sessionId is required");
		}
		const result = await handler(sessionId);
		return { applied: result.applied === true };
	}

	public async abortRuntimeSession(
		request: AbortRuntimeSessionRequest,
	): Promise<AbortRuntimeSessionResponse> {
		const handler = this.runtimeHandlers?.abortSession;
		if (!handler) {
			throw new Error("runtime abort handler is not configured");
		}
		const sessionId = safeString(request.sessionId).trim();
		if (!sessionId) {
			throw new Error("sessionId is required");
		}
		const result = await handler(sessionId);
		return { applied: result.applied === true };
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
		this.eventService.publishEvent({
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
		this.eventService.publishEvent({
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
		return this.eventService.publishEvent(request);
	}

	public addSubscriber(
		call: grpc.ServerWritableStream<StreamEventsRequest, RoutedEventMessage>,
	): number {
		return this.eventService.addSubscriber(call);
	}

	public removeSubscriber(subscriberId: number): void {
		this.eventService.removeSubscriber(subscriberId);
	}

	public requestToolApproval(
		request: RequestToolApprovalRequest,
	): Promise<RequestToolApprovalResponse> {
		return this.approvalService.requestToolApproval(request);
	}

	public respondToolApproval(
		request: RespondToolApprovalRequest,
	): RespondToolApprovalResponse {
		return this.approvalService.respondToolApproval(request);
	}

	public listPendingApprovals(
		request: ListPendingApprovalsRequest,
	): ListPendingApprovalsResponse {
		return this.approvalService.listPendingApprovals(request);
	}

	public createSchedule(
		request: CreateScheduleRequest,
	): CreateScheduleResponse {
		return this.scheduleService.createSchedule(request);
	}

	public getSchedule(request: GetScheduleRequest): GetScheduleResponse {
		return this.scheduleService.getSchedule(request);
	}

	public listSchedules(request: ListSchedulesRequest): ListSchedulesResponse {
		return this.scheduleService.listSchedules(request);
	}

	public updateSchedule(
		request: UpdateScheduleRequest,
	): UpdateScheduleResponse {
		return this.scheduleService.updateSchedule(request);
	}

	public deleteSchedule(
		request: DeleteScheduleRequest,
	): DeleteScheduleResponse {
		return this.scheduleService.deleteSchedule(request);
	}

	public pauseSchedule(request: PauseScheduleRequest): PauseScheduleResponse {
		return this.scheduleService.pauseSchedule(request);
	}

	public resumeSchedule(
		request: ResumeScheduleRequest,
	): ResumeScheduleResponse {
		return this.scheduleService.resumeSchedule(request);
	}

	public triggerScheduleNow(
		request: TriggerScheduleNowRequest,
	): Promise<TriggerScheduleNowResponse> {
		return this.scheduleService.triggerScheduleNow(request);
	}

	public listScheduleExecutions(
		request: ListScheduleExecutionsRequest,
	): ListScheduleExecutionsResponse {
		return this.scheduleService.listScheduleExecutions(request);
	}

	public getScheduleStats(
		request: GetScheduleStatsRequest,
	): GetScheduleStatsResponse {
		return this.scheduleService.getScheduleStats(request);
	}

	public getActiveScheduledExecutions(
		request: GetActiveScheduledExecutionsRequest,
	): GetActiveScheduledExecutionsResponse {
		return this.scheduleService.getActiveScheduledExecutions(request);
	}

	public getUpcomingScheduledRuns(
		request: GetUpcomingScheduledRunsRequest,
	): GetUpcomingScheduledRunsResponse {
		return this.scheduleService.getUpcomingScheduledRuns(request);
	}

	public broadcastServerEvent(eventType: string, payload: unknown): void {
		this.eventService.broadcastServerEvent(eventType, payload);
	}
}
