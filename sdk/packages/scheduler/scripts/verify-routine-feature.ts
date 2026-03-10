import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	RpcChatRunTurnRequest,
	RpcChatStartSessionRequest,
	RpcChatTurnResult,
} from "@cline/shared";
import { SchedulerService } from "../src/scheduler-service";

/**
 * Routine/schedule smoke verification script for developers.
 *
 * This runs a deterministic lifecycle against a temporary SQLite DB using mocked
 * runtime handlers to confirm the scheduler surface is wired correctly.
 *
 * Verified flow:
 * - createSchedule -> listSchedules -> pauseSchedule -> resumeSchedule
 * - triggerScheduleNow (manual execution path + execution metrics persistence)
 * - getScheduleStats + listScheduleExecutions
 * - deleteSchedule
 *
 * Success criteria: all assertions pass and JSON output includes `{ ok: true }`.
 * Failure criteria: any assertion throws, script exits non-zero, and prints error.
 */
function assert(condition: unknown, message: string): asserts condition {
	if (!condition) {
		throw new Error(message);
	}
}

async function main(): Promise<void> {
	const tempDir = await mkdtemp(join(tmpdir(), "cline-routine-verify-"));
	const sessionsDbPath = join(tempDir, "sessions.db");
	let sessionCounter = 0;

	const runtimeHandlers = {
		startSession: async (_request: RpcChatStartSessionRequest) => ({
			sessionId: `verify_session_${++sessionCounter}`,
		}),
		sendSession: async (
			_sessionId: string,
			_request: RpcChatRunTurnRequest,
		): Promise<{ result: RpcChatTurnResult }> => ({
			result: {
				text: "routine verified",
				iterations: 1,
				inputTokens: 5,
				outputTokens: 4,
				usage: {
					totalCost: 0.01,
					inputTokens: 0,
					outputTokens: 0,
				},
				finishReason: "",
				messages: [],
				toolCalls: [],
			},
		}),
		abortSession: async (_sessionId: string) => ({ applied: true }),
		stopSession: async (_sessionId: string) => ({ applied: true }),
	};

	const service = new SchedulerService({
		sessionsDbPath,
		runtimeHandlers,
	});

	try {
		const created = service.createSchedule({
			name: "Routine verification",
			cronPattern: "* * * * *",
			prompt: "confirm scheduler routine execution",
			provider: "cline",
			model: "openai/gpt-5.3-codex",
			mode: "act",
			workspaceRoot: "/tmp/workspace",
			maxParallel: 1,
			tags: ["verify", "routine"],
		});
		assert(created.scheduleId.length > 0, "failed to create schedule");
		assert(created.nextRunAt, "new schedule should have nextRunAt");

		const listed = service.listSchedules({ enabled: true, limit: 20 });
		assert(
			listed.some((item) => item.scheduleId === created.scheduleId),
			"created schedule was not listed",
		);

		const paused = service.pauseSchedule(created.scheduleId);
		assert(paused?.enabled === false, "pauseSchedule should disable schedule");
		assert(!paused?.nextRunAt, "paused schedule should clear nextRunAt");

		const resumed = service.resumeSchedule(created.scheduleId);
		assert(resumed?.enabled === true, "resumeSchedule should enable schedule");
		assert(resumed?.nextRunAt, "resumed schedule should restore nextRunAt");

		const execution = await service.triggerScheduleNow(created.scheduleId);
		assert(execution, "triggerScheduleNow should return an execution");
		assert(
			execution.status === "success",
			"manual trigger should complete successfully",
		);
		assert(
			execution.iterations === 1,
			"execution iterations should be persisted",
		);
		assert(
			execution.tokensUsed === 9,
			"execution token usage should be aggregated",
		);

		const stats = service.getScheduleStats(created.scheduleId);
		assert(stats.totalRuns === 1, "expected one recorded schedule run");
		assert(stats.successRate === 1, "expected 100% success rate");

		const history = service.listScheduleExecutions({
			scheduleId: created.scheduleId,
			limit: 10,
		});
		assert(history.length === 1, "expected one execution in history");
		assert(
			history[0]?.status === "success",
			"history should record successful execution",
		);

		const deleted = service.deleteSchedule(created.scheduleId);
		assert(deleted, "deleteSchedule should return true for existing schedule");

		process.stdout.write(
			`${JSON.stringify(
				{
					ok: true,
					scheduleId: created.scheduleId,
					executionId: execution.executionId,
					stats,
				},
				null,
				2,
			)}\n`,
		);
	} finally {
		await service.stop();
		await rm(tempDir, { recursive: true, force: true });
	}
}

main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`routine verification failed: ${message}\n`);
	process.exit(1);
});
