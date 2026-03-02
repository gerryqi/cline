/**
 * Tool Result Formatting
 *
 * Functions for formatting tool results for various purposes.
 */

import type { ToolCallRecord } from "../types.js";

/**
 * Format a tool result for sending back to the model
 *
 * The result is serialized to a string (JSON for objects, string for primitives)
 */
export function formatToolResult(output: unknown, error?: string): string {
	if (error) {
		return JSON.stringify({ error });
	}

	if (output === null || output === undefined) {
		return "null";
	}

	if (typeof output === "string") {
		return output;
	}

	if (typeof output === "number" || typeof output === "boolean") {
		return String(output);
	}

	try {
		return JSON.stringify(output);
	} catch {
		return String(output);
	}
}

/**
 * Format multiple tool results into a structured summary
 */
export function formatToolResultsSummary(records: ToolCallRecord[]): string {
	if (records.length === 0) {
		return "No tools were called.";
	}

	const lines = records.map((record) => {
		const status = record.error ? "FAILED" : "SUCCESS";
		const duration = `${record.durationMs}ms`;
		return `- ${record.name}: ${status} (${duration})`;
	});

	return `Tool Results:\n${lines.join("\n")}`;
}

/**
 * Format a tool call record as a detailed string
 */
export function formatToolCallRecord(record: ToolCallRecord): string {
	const lines = [
		`Tool: ${record.name}`,
		`ID: ${record.id}`,
		`Status: ${record.error ? "FAILED" : "SUCCESS"}`,
		`Duration: ${record.durationMs}ms`,
		`Started: ${record.startedAt.toISOString()}`,
		`Ended: ${record.endedAt.toISOString()}`,
	];

	if (record.error) {
		lines.push(`Error: ${record.error}`);
	}

	return lines.join("\n");
}
