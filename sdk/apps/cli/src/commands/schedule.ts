import { readFile } from "node:fs/promises";
import { getRpcServerHealth, RpcSessionClient } from "@clinebot/rpc";
import { runRpcEnsureCommand } from "./rpc";

interface CommandIo {
	writeln: (text?: string) => void;
	writeErr: (text: string) => void;
}

function resolveRpcAddress(rawArgs: string[]): string {
	const addressIndex = rawArgs.indexOf("--address");
	const address =
		(addressIndex >= 0 && addressIndex + 1 < rawArgs.length
			? rawArgs[addressIndex + 1]
			: process.env.CLINE_RPC_ADDRESS) || "127.0.0.1:4317";
	return address.trim();
}

function hasFlag(rawArgs: string[], flag: string): boolean {
	return rawArgs.includes(flag);
}

function getFlagValue(rawArgs: string[], flag: string): string | undefined {
	const index = rawArgs.indexOf(flag);
	if (index < 0 || index + 1 >= rawArgs.length) {
		return undefined;
	}
	const value = rawArgs[index + 1]?.trim();
	return value ? value : undefined;
}

function parseList(raw: string | undefined): string[] | undefined {
	if (!raw) {
		return undefined;
	}
	const out = raw
		.split(",")
		.map((value) => value.trim())
		.filter((value) => value.length > 0);
	return out.length > 0 ? out : undefined;
}

function parseJsonObjectFlag(
	raw: string | undefined,
): Record<string, unknown> | undefined {
	if (!raw?.trim()) {
		return undefined;
	}
	const parsed = JSON.parse(raw) as unknown;
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("metadata JSON must be an object");
	}
	return parsed as Record<string, unknown>;
}

function mergeScheduleDeliveryMetadata(
	base: Record<string, unknown> | undefined,
	rawArgs: string[],
): Record<string, unknown> | undefined {
	const adapter = getFlagValue(rawArgs, "--delivery-adapter")?.trim();
	const threadId = getFlagValue(rawArgs, "--delivery-thread")?.trim();
	const channelId = getFlagValue(rawArgs, "--delivery-channel")?.trim();
	const botUserName = getFlagValue(rawArgs, "--delivery-bot")?.trim();
	if (!adapter && !threadId && !channelId && !botUserName) {
		return base;
	}
	const next = { ...(base ?? {}) };
	const existingDelivery =
		next.delivery &&
		typeof next.delivery === "object" &&
		!Array.isArray(next.delivery)
			? (next.delivery as Record<string, unknown>)
			: {};
	next.delivery = {
		...existingDelivery,
		...(adapter ? { adapter } : {}),
		...(threadId ? { threadId } : {}),
		...(channelId ? { channelId } : {}),
		...(botUserName ? { botUserName } : {}),
	};
	return next;
}

function isJsonPath(path: string): boolean {
	return path.toLowerCase().endsWith(".json");
}

function parseMode(raw: string | undefined): "act" | "plan" | undefined {
	if (raw === "act" || raw === "plan") {
		return raw;
	}
	return undefined;
}

async function ensureSchedulerRpc(
	address: string,
	io: CommandIo,
): Promise<{ ok: boolean; address: string }> {
	const current = await getRpcServerHealth(address);
	if (current?.running) {
		return { ok: true, address };
	}
	let ensuredAddress = address;
	const code = await runRpcEnsureCommand(
		["rpc", "ensure", "--address", address, "--json"],
		(text) => {
			if (!text) {
				return;
			}
			try {
				const parsed = JSON.parse(text) as { address?: string };
				if (typeof parsed.address === "string" && parsed.address.trim()) {
					ensuredAddress = parsed.address.trim();
				}
			} catch {
				// ignore non-JSON lines
			}
		},
		io.writeErr,
	);
	if (code !== 0) {
		return { ok: false, address };
	}
	return { ok: true, address: ensuredAddress };
}

function emitJsonOrText(
	rawArgs: string[],
	io: CommandIo,
	value: unknown,
): void {
	if (hasFlag(rawArgs, "--json")) {
		io.writeln(JSON.stringify(value));
		return;
	}
	if (typeof value === "string") {
		io.writeln(value);
		return;
	}
	io.writeln(JSON.stringify(value, null, 2));
}

function toPositiveInt(value: string | undefined, fallback: number): number {
	const parsed = Number.parseInt(value ?? "", 10);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		return fallback;
	}
	return parsed;
}

export async function runScheduleCommand(
	rawArgs: string[],
	io: CommandIo,
): Promise<number> {
	let client: RpcSessionClient | undefined;
	try {
		const subcommand = rawArgs[1]?.trim().toLowerCase();
		if (!subcommand) {
			io.writeErr("missing schedule subcommand");
			return 1;
		}

		const requestedAddress = resolveRpcAddress(rawArgs);
		const ensured = await ensureSchedulerRpc(requestedAddress, io);
		if (!ensured.ok) {
			io.writeErr(`failed to ensure rpc server at ${requestedAddress}`);
			return 1;
		}

		client = new RpcSessionClient({ address: ensured.address });
		if (subcommand === "create") {
			const name = rawArgs[2]?.trim() || "";
			const cronPattern = getFlagValue(rawArgs, "--cron") ?? "";
			const prompt = getFlagValue(rawArgs, "--prompt") ?? "";
			const provider = getFlagValue(rawArgs, "--provider") ?? "cline";
			const model = getFlagValue(rawArgs, "--model") ?? "openai/gpt-5.3-codex";
			const workspaceRoot = getFlagValue(rawArgs, "--workspace");
			if (!name || !cronPattern || !prompt || !workspaceRoot) {
				io.writeErr(
					"schedule create requires: <name> --cron <pattern> --prompt <text> --workspace <path>",
				);
				return 1;
			}
			const metadata = mergeScheduleDeliveryMetadata(
				parseJsonObjectFlag(getFlagValue(rawArgs, "--metadata-json")),
				rawArgs,
			);
			const created = await client.createSchedule({
				name,
				cronPattern,
				prompt,
				provider,
				model,
				mode: getFlagValue(rawArgs, "--mode") === "plan" ? "plan" : "act",
				workspaceRoot,
				cwd: getFlagValue(rawArgs, "--cwd"),
				systemPrompt: getFlagValue(rawArgs, "--system-prompt"),
				maxIterations: getFlagValue(rawArgs, "--max-iterations")
					? toPositiveInt(getFlagValue(rawArgs, "--max-iterations"), 1)
					: undefined,
				timeoutSeconds: getFlagValue(rawArgs, "--timeout")
					? toPositiveInt(getFlagValue(rawArgs, "--timeout"), 1)
					: undefined,
				maxParallel: toPositiveInt(getFlagValue(rawArgs, "--max-parallel"), 1),
				enabled: !hasFlag(rawArgs, "--disabled"),
				createdBy: getFlagValue(rawArgs, "--created-by"),
				tags: parseList(getFlagValue(rawArgs, "--tags")),
				metadata,
			});
			if (!created) {
				io.writeErr("failed to create schedule");
				return 1;
			}
			emitJsonOrText(rawArgs, io, created);
			return 0;
		}

		if (subcommand === "list") {
			const enabled = hasFlag(rawArgs, "--enabled")
				? true
				: hasFlag(rawArgs, "--disabled")
					? false
					: undefined;
			const schedules = await client.listSchedules({
				limit: toPositiveInt(getFlagValue(rawArgs, "--limit"), 100),
				enabled,
				tags: parseList(getFlagValue(rawArgs, "--tags")),
			});
			if (
				!hasFlag(rawArgs, "--json") &&
				Array.isArray(schedules) &&
				schedules.length === 0
			) {
				io.writeln("No schedules found.");
				return 0;
			}
			emitJsonOrText(rawArgs, io, schedules);
			return 0;
		}

		if (subcommand === "get") {
			const scheduleId = rawArgs[2]?.trim() || "";
			if (!scheduleId) {
				io.writeErr("schedule get requires <schedule-id>");
				return 1;
			}
			const schedule = await client.getSchedule(scheduleId);
			if (!schedule) {
				io.writeErr(`schedule not found: ${scheduleId}`);
				return 1;
			}
			emitJsonOrText(rawArgs, io, schedule);
			return 0;
		}

		if (subcommand === "export") {
			const scheduleId = rawArgs[2]?.trim() || "";
			if (!scheduleId) {
				io.writeErr("schedule export requires <schedule-id>");
				return 1;
			}
			const schedule = await client.getSchedule(scheduleId);
			if (!schedule) {
				io.writeErr(`schedule not found: ${scheduleId}`);
				return 1;
			}
			const outputPath = getFlagValue(rawArgs, "--to");
			if (
				hasFlag(rawArgs, "--json") ||
				(outputPath && isJsonPath(outputPath))
			) {
				io.writeln(JSON.stringify(schedule, null, 2));
				return 0;
			}
			const yaml = await import("yaml");
			io.writeln(yaml.stringify(schedule));
			return 0;
		}

		if (subcommand === "import") {
			const sourcePath = rawArgs[2]?.trim() || "";
			if (!sourcePath) {
				io.writeErr("schedule import requires <path>");
				return 1;
			}
			const sourceRaw = await readFile(sourcePath, "utf8");
			let parsed: Record<string, unknown>;
			if (isJsonPath(sourcePath)) {
				parsed = JSON.parse(sourceRaw) as Record<string, unknown>;
			} else {
				const yaml = await import("yaml");
				parsed = yaml.parse(sourceRaw) as Record<string, unknown>;
			}
			const workspaceRoot = String(
				parsed.workspaceRoot ?? parsed.workspace_root ?? "",
			).trim();
			if (!workspaceRoot) {
				io.writeErr(
					"schedule import requires workspaceRoot/workspace_root in the source file",
				);
				return 1;
			}
			const created = await client.createSchedule({
				name: String(parsed.name ?? "").trim(),
				cronPattern: String(parsed.cronPattern ?? parsed.cron ?? "").trim(),
				prompt: String(parsed.prompt ?? "").trim(),
				provider: String(parsed.provider ?? "cline").trim(),
				model: String(parsed.model ?? "openai/gpt-5.3-codex").trim(),
				mode: parsed.mode === "plan" ? "plan" : "act",
				workspaceRoot,
				cwd: String(parsed.cwd ?? "").trim() || undefined,
				systemPrompt:
					String(parsed.systemPrompt ?? parsed.system_prompt ?? "").trim() ||
					undefined,
				maxIterations:
					typeof parsed.maxIterations === "number"
						? parsed.maxIterations
						: typeof parsed.max_iterations === "number"
							? parsed.max_iterations
							: undefined,
				timeoutSeconds:
					typeof parsed.timeoutSeconds === "number"
						? parsed.timeoutSeconds
						: typeof parsed.timeout_seconds === "number"
							? parsed.timeout_seconds
							: undefined,
				maxParallel:
					typeof parsed.maxParallel === "number"
						? parsed.maxParallel
						: typeof parsed.max_parallel === "number"
							? parsed.max_parallel
							: 1,
				enabled: parsed.enabled !== false,
				createdBy:
					String(parsed.createdBy ?? parsed.created_by ?? "").trim() ||
					undefined,
				tags: Array.isArray(parsed.tags)
					? parsed.tags
							.map((item) => (typeof item === "string" ? item.trim() : ""))
							.filter((item) => item.length > 0)
					: undefined,
				metadata:
					parsed.metadata && typeof parsed.metadata === "object"
						? (parsed.metadata as Record<string, unknown>)
						: undefined,
			});
			if (!created) {
				io.writeErr("failed to import schedule");
				return 1;
			}
			emitJsonOrText(rawArgs, io, created);
			return 0;
		}

		if (subcommand === "update") {
			const scheduleId = rawArgs[2]?.trim() || "";
			if (!scheduleId) {
				io.writeErr("schedule update requires <schedule-id>");
				return 1;
			}
			if (hasFlag(rawArgs, "--pause")) {
				const schedule = await client.pauseSchedule(scheduleId);
				emitJsonOrText(rawArgs, io, schedule ?? { updated: false });
				return schedule ? 0 : 1;
			}
			if (hasFlag(rawArgs, "--resume")) {
				const schedule = await client.resumeSchedule(scheduleId);
				emitJsonOrText(rawArgs, io, schedule ?? { updated: false });
				return schedule ? 0 : 1;
			}
			const metadata = mergeScheduleDeliveryMetadata(
				parseJsonObjectFlag(getFlagValue(rawArgs, "--metadata-json")),
				rawArgs,
			);
			const updated = await client.updateSchedule(scheduleId, {
				name: getFlagValue(rawArgs, "--name"),
				cronPattern: getFlagValue(rawArgs, "--cron"),
				prompt: getFlagValue(rawArgs, "--prompt"),
				provider: getFlagValue(rawArgs, "--provider"),
				model: getFlagValue(rawArgs, "--model"),
				mode: parseMode(getFlagValue(rawArgs, "--mode")),
				workspaceRoot: getFlagValue(rawArgs, "--workspace"),
				cwd: getFlagValue(rawArgs, "--cwd"),
				systemPrompt: getFlagValue(rawArgs, "--system-prompt"),
				maxIterations: getFlagValue(rawArgs, "--max-iterations")
					? toPositiveInt(getFlagValue(rawArgs, "--max-iterations"), 1)
					: hasFlag(rawArgs, "--clear-max-iterations")
						? null
						: undefined,
				timeoutSeconds: getFlagValue(rawArgs, "--timeout")
					? toPositiveInt(getFlagValue(rawArgs, "--timeout"), 1)
					: hasFlag(rawArgs, "--clear-timeout")
						? null
						: undefined,
				maxParallel: getFlagValue(rawArgs, "--max-parallel")
					? toPositiveInt(getFlagValue(rawArgs, "--max-parallel"), 1)
					: undefined,
				enabled: hasFlag(rawArgs, "--enabled")
					? true
					: hasFlag(rawArgs, "--disabled")
						? false
						: undefined,
				tags: getFlagValue(rawArgs, "--tags")
					? parseList(getFlagValue(rawArgs, "--tags"))
					: undefined,
				metadata,
			});
			if (!updated) {
				io.writeErr(`schedule not found: ${scheduleId}`);
				return 1;
			}
			emitJsonOrText(rawArgs, io, updated);
			return 0;
		}

		if (subcommand === "delete") {
			const scheduleId = rawArgs[2]?.trim() || "";
			if (!scheduleId) {
				io.writeErr("schedule delete requires <schedule-id>");
				return 1;
			}
			const deleted = await client.deleteSchedule(scheduleId);
			emitJsonOrText(rawArgs, io, { deleted });
			return deleted ? 0 : 1;
		}

		if (subcommand === "pause") {
			const scheduleId = rawArgs[2]?.trim() || "";
			if (!scheduleId) {
				io.writeErr("schedule pause requires <schedule-id>");
				return 1;
			}
			const schedule = await client.pauseSchedule(scheduleId);
			if (!schedule) {
				io.writeErr(`schedule not found: ${scheduleId}`);
				return 1;
			}
			emitJsonOrText(rawArgs, io, schedule);
			return 0;
		}

		if (subcommand === "resume") {
			const scheduleId = rawArgs[2]?.trim() || "";
			if (!scheduleId) {
				io.writeErr("schedule resume requires <schedule-id>");
				return 1;
			}
			const schedule = await client.resumeSchedule(scheduleId);
			if (!schedule) {
				io.writeErr(`schedule not found: ${scheduleId}`);
				return 1;
			}
			emitJsonOrText(rawArgs, io, schedule);
			return 0;
		}

		if (subcommand === "trigger") {
			const scheduleId = rawArgs[2]?.trim() || "";
			if (!scheduleId) {
				io.writeErr("schedule trigger requires <schedule-id>");
				return 1;
			}
			const execution = await client.triggerScheduleNow(scheduleId);
			if (!execution) {
				io.writeErr(`schedule not found: ${scheduleId}`);
				return 1;
			}
			emitJsonOrText(rawArgs, io, execution);
			return 0;
		}

		if (subcommand === "history") {
			const scheduleId = rawArgs[2]?.trim() || "";
			if (!scheduleId) {
				io.writeErr("schedule history requires <schedule-id>");
				return 1;
			}
			const executions = await client.listScheduleExecutions({
				scheduleId,
				status: getFlagValue(rawArgs, "--status"),
				limit: toPositiveInt(getFlagValue(rawArgs, "--limit"), 20),
			});
			emitJsonOrText(rawArgs, io, executions);
			return 0;
		}

		if (subcommand === "stats") {
			const scheduleId = rawArgs[2]?.trim() || "";
			if (!scheduleId) {
				io.writeErr("schedule stats requires <schedule-id>");
				return 1;
			}
			const stats = await client.getScheduleStats(scheduleId);
			emitJsonOrText(rawArgs, io, stats);
			return 0;
		}

		if (subcommand === "active") {
			const active = await client.getActiveScheduledExecutions();
			emitJsonOrText(rawArgs, io, active);
			return 0;
		}

		if (subcommand === "upcoming") {
			const runs = await client.getUpcomingScheduledRuns(
				toPositiveInt(getFlagValue(rawArgs, "--limit"), 20),
			);
			emitJsonOrText(rawArgs, io, runs);
			return 0;
		}

		io.writeErr(`unknown schedule subcommand "${subcommand}"`);
		return 1;
	} catch (error) {
		io.writeErr(error instanceof Error ? error.message : String(error));
		return 1;
	} finally {
		client?.close();
	}
}
