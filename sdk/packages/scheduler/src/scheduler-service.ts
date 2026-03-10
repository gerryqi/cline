import { randomUUID } from "node:crypto";
import type {
	RpcChatRunTurnRequest,
	RpcChatStartSessionRequest,
} from "@cline/shared";
import { nowIso } from "@cline/shared/db";
import { assertValidCronPattern } from "./cron";
import { ResourceLimiter } from "./resource-limiter";
import { ScheduleStore } from "./schedule-store";
import type {
	ActiveScheduledExecution,
	CreateScheduleInput,
	ListScheduleExecutionsOptions,
	ListSchedulesOptions,
	ScheduleExecutionRecord,
	ScheduleExecutionStatus,
	ScheduleRecord,
	SchedulerServiceOptions,
	UpdateScheduleInput,
} from "./types";

function toErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}

function parseTurnMetrics(resultJson: string): {
	iterations?: number;
	tokensUsed?: number;
	costUsd?: number;
} {
	try {
		const parsed = JSON.parse(resultJson) as {
			iterations?: unknown;
			usage?: { totalCost?: unknown };
			inputTokens?: unknown;
			outputTokens?: unknown;
		};
		const inputTokens =
			typeof parsed.inputTokens === "number" ? parsed.inputTokens : undefined;
		const outputTokens =
			typeof parsed.outputTokens === "number" ? parsed.outputTokens : undefined;
		return {
			iterations:
				typeof parsed.iterations === "number" ? parsed.iterations : undefined,
			tokensUsed:
				inputTokens !== undefined && outputTokens !== undefined
					? inputTokens + outputTokens
					: undefined,
			costUsd:
				typeof parsed.usage?.totalCost === "number"
					? parsed.usage.totalCost
					: undefined,
		};
	} catch {
		return {};
	}
}

class TimeoutError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "TimeoutError";
	}
}

async function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
): Promise<T> {
	if (timeoutMs <= 0) {
		return await promise;
	}
	let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
	const timeoutPromise = new Promise<never>((_, reject) => {
		timeoutHandle = setTimeout(() => {
			reject(new TimeoutError("scheduled execution timed out"));
		}, timeoutMs);
	});
	try {
		return await Promise.race([promise, timeoutPromise]);
	} finally {
		if (timeoutHandle) {
			clearTimeout(timeoutHandle);
		}
	}
}

export class SchedulerService {
	private readonly store: ScheduleStore;
	private readonly resourceLimiter: ResourceLimiter;
	private readonly options: SchedulerServiceOptions;
	private readonly activeExecutions = new Map<
		string,
		ActiveScheduledExecution
	>();
	private timer: ReturnType<typeof setInterval> | undefined;
	private started = false;

	constructor(options: SchedulerServiceOptions) {
		this.options = options;
		this.store = new ScheduleStore({ sessionsDbPath: options.sessionsDbPath });
		this.resourceLimiter = new ResourceLimiter(
			options.globalMaxConcurrency ?? 10,
		);
	}

	public async start(): Promise<void> {
		if (this.started) {
			return;
		}
		this.started = true;
		await this.tick();
		const intervalMs = Math.max(
			5_000,
			optionsOrDefault(this.options.pollIntervalMs, 30_000),
		);
		this.timer = setInterval(() => {
			void this.tick();
		}, intervalMs);
	}

	public async stop(): Promise<void> {
		if (!this.started) {
			return;
		}
		this.started = false;
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
		const active = Array.from(this.activeExecutions.values());
		await Promise.all(
			active.map(async (execution) => {
				try {
					await this.options.runtimeHandlers.abortSession(execution.sessionId);
				} catch {
					// Best-effort abort during shutdown.
				}
			}),
		);
	}

	public createSchedule(input: CreateScheduleInput): ScheduleRecord {
		assertValidCronPattern(input.cronPattern);
		if (!input.workspaceRoot?.trim()) {
			throw new Error("workspaceRoot is required for schedules");
		}
		return this.store.createSchedule(input);
	}

	public getSchedule(scheduleId: string): ScheduleRecord | undefined {
		return this.store.getSchedule(scheduleId);
	}

	public listSchedules(options: ListSchedulesOptions = {}): ScheduleRecord[] {
		return this.store.listSchedules(options);
	}

	public updateSchedule(
		scheduleId: string,
		updates: UpdateScheduleInput,
	): ScheduleRecord | undefined {
		if (updates.cronPattern !== undefined) {
			assertValidCronPattern(updates.cronPattern);
		}
		const current = this.store.getSchedule(scheduleId);
		if (!current) {
			return undefined;
		}
		const nextWorkspaceRoot =
			updates.workspaceRoot !== undefined
				? updates.workspaceRoot.trim()
				: (current.workspaceRoot ?? "");
		const nextEnabled = updates.enabled ?? current.enabled;
		if (nextEnabled && !nextWorkspaceRoot) {
			throw new Error("workspaceRoot is required for enabled schedules");
		}
		return this.store.updateSchedule(scheduleId, updates);
	}

	public deleteSchedule(scheduleId: string): boolean {
		return this.store.deleteSchedule(scheduleId);
	}

	public pauseSchedule(scheduleId: string): ScheduleRecord | undefined {
		return this.updateSchedule(scheduleId, { enabled: false });
	}

	public resumeSchedule(scheduleId: string): ScheduleRecord | undefined {
		return this.updateSchedule(scheduleId, { enabled: true });
	}

	public async triggerScheduleNow(
		scheduleId: string,
	): Promise<ScheduleExecutionRecord | undefined> {
		const schedule = this.store.getSchedule(scheduleId);
		if (!schedule) {
			return undefined;
		}
		return await this.executeSchedule(schedule, nowIso(), "manual");
	}

	public listScheduleExecutions(
		options: ListScheduleExecutionsOptions,
	): ScheduleExecutionRecord[] {
		return this.store.listExecutions(options);
	}

	public getScheduleStats(scheduleId: string) {
		return this.store.getExecutionStats(scheduleId);
	}

	public getActiveExecutions(): ActiveScheduledExecution[] {
		return Array.from(this.activeExecutions.values());
	}

	public getUpcomingRuns(limit = 20): Array<{
		scheduleId: string;
		name: string;
		nextRunAt: string;
	}> {
		return this.store.listUpcomingRuns(limit);
	}

	private async tick(): Promise<void> {
		const dueSchedules = this.store.listDueSchedules(nowIso());
		for (const schedule of dueSchedules) {
			const triggeredAt = nowIso();
			this.store.markScheduleTriggered(schedule.scheduleId, triggeredAt);
			void this.executeSchedule(schedule, triggeredAt, "scheduled");
		}
	}

	private buildStartRequest(
		schedule: ScheduleRecord,
	): RpcChatStartSessionRequest {
		const workspaceRoot = schedule.workspaceRoot?.trim();
		if (!workspaceRoot) {
			throw new Error("schedule requires workspaceRoot");
		}
		const request: RpcChatStartSessionRequest = {
			workspaceRoot,
			cwd: schedule.cwd?.trim() || workspaceRoot,
			provider: schedule.provider,
			model: schedule.model,
			mode: schedule.mode,
			apiKey: "",
			systemPrompt: schedule.systemPrompt,
			maxIterations: schedule.maxIterations,
			enableTools: true,
			enableSpawn: true,
			enableTeams: true,
			autoApproveTools: true,
			teamName: `scheduled-${schedule.scheduleId}`,
			missionStepInterval: 3,
			missionTimeIntervalMs: 120000,
		};
		return request;
	}

	private async executeSchedule(
		schedule: ScheduleRecord,
		triggeredAt: string,
		trigger: "scheduled" | "manual",
	): Promise<ScheduleExecutionRecord> {
		const executionId = `exec_${randomUUID()}`;
		const pending: ScheduleExecutionRecord = {
			executionId,
			scheduleId: schedule.scheduleId,
			triggeredAt,
			status: "pending",
		};
		this.store.recordExecution(pending);

		const acquired = this.resourceLimiter.acquire(
			schedule.scheduleId,
			executionId,
			schedule.maxParallel,
		);
		if (!acquired) {
			const skipped: ScheduleExecutionRecord = {
				...pending,
				status: "failed",
				endedAt: nowIso(),
				errorMessage: "concurrency limit reached",
			};
			this.store.recordExecution(skipped);
			return skipped;
		}

		let sessionId: string | undefined;
		let startedAt: string | undefined;
		let timeoutAt: string | undefined;

		try {
			const startRequest = this.buildStartRequest(schedule);
			const startResponse = await this.options.runtimeHandlers.startSession(
				JSON.stringify(startRequest),
			);
			sessionId = startResponse.sessionId.trim();
			if (!sessionId) {
				throw new Error("runtime start returned empty sessionId");
			}
			startedAt = nowIso();
			timeoutAt =
				typeof schedule.timeoutSeconds === "number" &&
				schedule.timeoutSeconds > 0
					? new Date(
							new Date(startedAt).getTime() + schedule.timeoutSeconds * 1000,
						).toISOString()
					: undefined;

			const runningState: ScheduleExecutionRecord = {
				...pending,
				sessionId,
				startedAt,
				status: "running",
			};
			this.store.recordExecution(runningState);
			this.activeExecutions.set(executionId, {
				executionId,
				scheduleId: schedule.scheduleId,
				sessionId,
				startedAt,
				timeoutAt,
			});
			this.publishEvent("schedule.execution.started", {
				scheduleId: schedule.scheduleId,
				executionId,
				sessionId,
				trigger,
				triggeredAt,
			});

			const turnRequest: RpcChatRunTurnRequest = {
				config: startRequest,
				prompt: schedule.prompt,
			};
			const sendPromise = this.options.runtimeHandlers.sendSession(
				sessionId,
				JSON.stringify(turnRequest),
			);
			const sendResult = await withTimeout(
				sendPromise,
				(schedule.timeoutSeconds ?? 0) * 1000,
			);
			const metrics = parseTurnMetrics(sendResult.resultJson);
			const completed: ScheduleExecutionRecord = {
				...runningState,
				status: "success",
				endedAt: nowIso(),
				iterations: metrics.iterations,
				tokensUsed: metrics.tokensUsed,
				costUsd: metrics.costUsd,
			};
			this.store.recordExecution(completed);
			this.publishEvent("schedule.execution.completed", {
				scheduleId: schedule.scheduleId,
				executionId,
				sessionId,
				status: completed.status,
				durationMs:
					completed.startedAt && completed.endedAt
						? new Date(completed.endedAt).getTime() -
							new Date(completed.startedAt).getTime()
						: undefined,
			});
			return completed;
		} catch (error) {
			const status: ScheduleExecutionStatus =
				error instanceof TimeoutError ? "timeout" : "failed";
			if (sessionId && status === "timeout") {
				try {
					await this.options.runtimeHandlers.abortSession(sessionId);
				} catch {
					// Best-effort timeout abort.
				}
			}
			const failed: ScheduleExecutionRecord = {
				executionId,
				scheduleId: schedule.scheduleId,
				sessionId,
				triggeredAt,
				startedAt,
				endedAt: nowIso(),
				status,
				errorMessage: toErrorMessage(error),
			};
			this.store.recordExecution(failed);
			this.publishEvent("schedule.execution.completed", {
				scheduleId: schedule.scheduleId,
				executionId,
				sessionId,
				status: failed.status,
				errorMessage: failed.errorMessage,
			});
			return failed;
		} finally {
			if (sessionId) {
				try {
					await this.options.runtimeHandlers.stopSession(sessionId);
				} catch {
					// Best-effort stop.
				}
			}
			this.activeExecutions.delete(executionId);
			this.resourceLimiter.release(schedule.scheduleId, executionId);
			this.store.markScheduleTriggered(
				schedule.scheduleId,
				startedAt ?? triggeredAt,
			);
		}
	}

	private publishEvent(eventType: string, payload: unknown): void {
		this.options.eventPublisher?.(eventType, payload);
	}
}

function optionsOrDefault(value: number | undefined, fallback: number): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return fallback;
	}
	return Math.floor(value);
}
