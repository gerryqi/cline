import type { RunHookResult } from "@cline/agents";
import {
	appendHookAudit,
	parseCliHookPayload,
	readStdinUtf8,
	truncate,
	writeHookJson,
} from "../utils/helpers";
import { getCoreSessionBackend } from "../utils/session";

export async function runHookCommand(writeErr: (text: string) => void) {
	try {
		const raw = (await readStdinUtf8()).trim();
		if (!raw) {
			writeErr("hook command expects JSON payload on stdin");
			return 1;
		}

		const parsed = JSON.parse(raw) as unknown;
		const payload = parseCliHookPayload(parsed);
		if (!payload) {
			writeErr("invalid hook payload");
			return 1;
		}

		appendHookAudit(payload);
		const sessions = await getCoreSessionBackend();
		await sessions.queueSpawnRequest(payload);
		const subSessionId = await sessions.upsertSubagentSessionFromHook(payload);
		if (subSessionId) {
			await sessions.appendSubagentHookAudit(subSessionId, payload);
			if (payload.hookName === "tool_call") {
				await sessions.appendSubagentTranscriptLine(
					subSessionId,
					`[tool] ${payload.tool_call?.name ?? "unknown"}`,
				);
			}
			if (payload.hookName === "agent_end") {
				await sessions.appendSubagentTranscriptLine(
					subSessionId,
					"[done] completed",
				);
			}
			if (payload.hookName === "session_shutdown") {
				await sessions.appendSubagentTranscriptLine(
					subSessionId,
					`[shutdown] ${payload.reason ?? "session shutdown"}`,
				);
			}
			await sessions.applySubagentStatus(subSessionId, payload);
		}

		switch (payload.hookName) {
			case "tool_call":
			case "tool_result":
			case "agent_end":
			case "agent_start":
			case "agent_resume":
			case "agent_abort":
			case "prompt_submit":
			case "pre_compact":
			case "session_shutdown":
				writeHookJson({});
				return 0;
			default:
				writeErr(
					`unsupported hookName: ${(payload as { hookName: string }).hookName}`,
				);
				return 1;
		}
	} catch (error) {
		writeErr(error instanceof Error ? error.message : String(error));
		return 1;
	}
}

export function formatHookDispatchOutput(result?: RunHookResult): string {
	const value = result?.parsedJson;
	if (value === undefined || value === null) {
		return "";
	}
	if (
		typeof value === "object" &&
		!Array.isArray(value) &&
		Object.keys(value as Record<string, unknown>).length === 0
	) {
		return "";
	}
	if (typeof value === "string") {
		return truncate(value, 100);
	}
	return truncate(JSON.stringify(value), 100);
}
