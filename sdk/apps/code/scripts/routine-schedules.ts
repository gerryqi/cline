import { readFileSync } from "node:fs";
import { RpcSessionClient } from "@cline/rpc";

type RoutineAction =
	| "listOverview"
	| "createSchedule"
	| "pauseSchedule"
	| "resumeSchedule"
	| "triggerScheduleNow"
	| "deleteSchedule";

interface RoutineRequest {
	action: RoutineAction;
	scheduleId?: string;
	name?: string;
	cronPattern?: string;
	prompt?: string;
	provider?: string;
	model?: string;
	mode?: "act" | "plan";
	workspaceRoot?: string;
	cwd?: string;
	systemPrompt?: string;
	maxIterations?: number;
	timeoutSeconds?: number;
	maxParallel?: number;
	enabled?: boolean;
	tags?: string[];
	limit?: number;
}

function readStdin(): string {
	return readFileSync(0, "utf8");
}

function toPositiveInt(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return undefined;
	}
	const rounded = Math.trunc(value);
	return rounded > 0 ? rounded : undefined;
}

function asTrimmedString(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

async function main() {
	const parsed = JSON.parse(readStdin()) as RoutineRequest;
	const action = parsed.action;
	const address = process.env.CLINE_RPC_ADDRESS?.trim() || "127.0.0.1:4317";
	const client = new RpcSessionClient({ address });
	try {
		if (action === "listOverview") {
			const [schedules, activeExecutions, upcomingRuns] = await Promise.all([
				client.listSchedules({
					limit: toPositiveInt(parsed.limit) ?? 200,
				}),
				client.getActiveScheduledExecutions(),
				client.getUpcomingScheduledRuns(30),
			]);
			process.stdout.write(
				`${JSON.stringify({ schedules, activeExecutions, upcomingRuns })}\n`,
			);
			return;
		}

		if (action === "createSchedule") {
			const name = asTrimmedString(parsed.name);
			const cronPattern = asTrimmedString(parsed.cronPattern);
			const prompt = asTrimmedString(parsed.prompt);
			const workspaceRoot = asTrimmedString(parsed.workspaceRoot);
			if (!name || !cronPattern || !prompt || !workspaceRoot) {
				throw new Error(
					"createSchedule requires name, cronPattern, prompt, and workspaceRoot",
				);
			}

			const created = await client.createSchedule({
				name,
				cronPattern,
				prompt,
				provider: asTrimmedString(parsed.provider) ?? "cline",
				model: asTrimmedString(parsed.model) ?? "openai/gpt-5.3-codex",
				mode: parsed.mode === "plan" ? "plan" : "act",
				workspaceRoot,
				cwd: asTrimmedString(parsed.cwd),
				systemPrompt: asTrimmedString(parsed.systemPrompt),
				maxIterations: toPositiveInt(parsed.maxIterations),
				timeoutSeconds: toPositiveInt(parsed.timeoutSeconds),
				maxParallel: toPositiveInt(parsed.maxParallel) ?? 1,
				enabled: parsed.enabled !== false,
				tags:
					Array.isArray(parsed.tags) && parsed.tags.length > 0
						? parsed.tags
								.map((value) => value.trim())
								.filter((value) => value.length > 0)
						: undefined,
			});
			process.stdout.write(
				`${JSON.stringify({ schedule: created ?? null })}\n`,
			);
			return;
		}

		const scheduleId = asTrimmedString(parsed.scheduleId);
		if (!scheduleId) {
			throw new Error(`${action} requires scheduleId`);
		}

		if (action === "pauseSchedule") {
			const schedule = await client.pauseSchedule(scheduleId);
			process.stdout.write(
				`${JSON.stringify({ schedule: schedule ?? null })}\n`,
			);
			return;
		}

		if (action === "resumeSchedule") {
			const schedule = await client.resumeSchedule(scheduleId);
			process.stdout.write(
				`${JSON.stringify({ schedule: schedule ?? null })}\n`,
			);
			return;
		}

		if (action === "triggerScheduleNow") {
			const execution = await client.triggerScheduleNow(scheduleId);
			process.stdout.write(
				`${JSON.stringify({ execution: execution ?? null })}\n`,
			);
			return;
		}

		if (action === "deleteSchedule") {
			const deleted = await client.deleteSchedule(scheduleId);
			process.stdout.write(`${JSON.stringify({ deleted })}\n`);
			return;
		}

		throw new Error(`Unsupported action: ${action}`);
	} finally {
		client.close();
	}
}

main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(message);
	process.exit(1);
});
