import type { ParsedLogEvent } from "./types";

// biome-ignore lint/suspicious/noControlCharactersInRegex: We need to match ANSI escape codes to strip them out of logs.
const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;

export function stripAnsi(input: string): string {
	return input.replace(ANSI_PATTERN, "");
}

export function summarizeSessionReason(
	reason: string,
): "completed" | "failed" | "cancelled" {
	const normalized = reason.toLowerCase();
	if (
		normalized.includes("stopped") ||
		normalized.includes("abort") ||
		normalized.includes("cancel")
	) {
		return "cancelled";
	}
	if (
		normalized.includes("completed") ||
		normalized.includes("exited (exitstatus(unix_wait_status(0)))")
	) {
		return "completed";
	}
	return "failed";
}

export function parseLineToEvent(line: string): ParsedLogEvent | undefined {
	const cleaned = stripAnsi(line).trim();
	if (!cleaned) {
		return undefined;
	}

	const ts = Date.now();

	if (cleaned.startsWith("[team task]")) {
		return { ts, type: "team_task", text: cleaned };
	}
	if (cleaned.startsWith("[mailbox]")) {
		return { ts, type: "mailbox", text: cleaned };
	}
	if (cleaned.startsWith("[mission]")) {
		return { ts, type: "mission", text: cleaned };
	}
	if (cleaned.startsWith("[team]")) {
		return { ts, type: "team", text: cleaned };
	}
	if (cleaned.startsWith("[")) {
		return { ts, type: "tool", text: cleaned };
	}
	if (cleaned.startsWith("error:")) {
		return { ts, type: "error", text: cleaned };
	}

	return { ts, type: "info", text: cleaned };
}
