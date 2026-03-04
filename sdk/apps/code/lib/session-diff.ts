export type SessionHookEvent = {
	hookEventName:
		| "tool_call"
		| "tool_result"
		| "agent_end"
		| "session_shutdown"
		| string;
	toolName?: string;
	toolInput?: unknown;
	toolOutput?: unknown;
	toolError?: string;
};

export type SessionDiffHunk = {
	oldStart: number;
	newStart: number;
	old: string;
	new: string;
};

export type SessionFileDiff = {
	path: string;
	additions: number;
	deletions: number;
	hunks: SessionDiffHunk[];
};

export type SessionDiffSummary = {
	additions: number;
	deletions: number;
};

export type SessionDiffState = {
	fileDiffs: SessionFileDiff[];
	summary: SessionDiffSummary;
};

export const EMPTY_DIFF_SUMMARY: SessionDiffSummary = {
	additions: 0,
	deletions: 0,
};

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object") {
		return null;
	}
	return value as Record<string, unknown>;
}

function toStringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function countAddedLines(value: string | undefined): number {
	if (!value) {
		return 0;
	}
	return value.split("\n").filter((line) => line.length > 0).length;
}

function parseDiffFromEditorResult(
	resultText: string,
): Pick<SessionFileDiff, "additions" | "deletions" | "hunks"> {
	const lines = resultText.split("\n");
	const startIdx = lines.findIndex((line) => line.trim() === "```diff");
	if (startIdx < 0) {
		return { additions: 0, deletions: 0, hunks: [] };
	}
	const endIdx = lines.findIndex(
		(line, idx) => idx > startIdx && line.trim() === "```",
	);
	const body = lines.slice(
		startIdx + 1,
		endIdx > startIdx ? endIdx : undefined,
	);

	const old: string[] = [];
	const next: string[] = [];
	let additions = 0;
	let deletions = 0;
	let oldStart: number | undefined;
	let newStart: number | undefined;

	for (const raw of body) {
		const match = raw.match(/^([+-])(\d+):\s?(.*)$/);
		if (!match) {
			continue;
		}

		const op = match[1];
		const lineNo = Number.parseInt(match[2], 10);
		const text = match[3] ?? "";
		if (op === "-") {
			deletions += 1;
			old.push(text);
			oldStart = oldStart ?? lineNo;
			continue;
		}

		additions += 1;
		next.push(text);
		newStart = newStart ?? lineNo;
	}

	if (additions + deletions === 0) {
		return { additions: 0, deletions: 0, hunks: [] };
	}

	return {
		additions,
		deletions,
		hunks: [
			{
				oldStart: oldStart ?? 1,
				newStart: newStart ?? 1,
				old: old.join("\n"),
				new: next.join("\n"),
			},
		],
	};
}

function parseEditorFileDiff(event: SessionHookEvent): SessionFileDiff | null {
	if (
		event.hookEventName !== "tool_result" ||
		event.toolName !== "editor" ||
		event.toolError
	) {
		return null;
	}

	const input = asRecord(event.toolInput);
	const output = asRecord(event.toolOutput);
	if (!input || !output || output.success === false) {
		return null;
	}

	const command = toStringValue(input.command);
	const pathFromInput = toStringValue(input.path);
	const query = toStringValue(output.query);
	const pathFromQuery = query?.includes(":")
		? query.split(":").slice(1).join(":")
		: undefined;
	const path = pathFromInput || pathFromQuery;
	if (!path) {
		return null;
	}

	if (command === "str_replace") {
		const parsed = parseDiffFromEditorResult(
			toStringValue(output.result) ?? "",
		);
		return {
			path,
			additions: parsed.additions,
			deletions: parsed.deletions,
			hunks: parsed.hunks,
		};
	}

	if (command === "create" || command === "insert") {
		const newContent =
			toStringValue(input.file_text) ?? toStringValue(input.new_str) ?? "";
		return {
			path,
			additions: countAddedLines(newContent),
			deletions: 0,
			hunks: newContent
				? [
						{
							oldStart: 1,
							newStart: 1,
							old: "",
							new: newContent,
						},
					]
				: [],
		};
	}

	return null;
}

export function mergeEditorDiffs(
	events: SessionHookEvent[],
): SessionFileDiff[] {
	const byPath = new Map<string, SessionFileDiff>();

	for (const event of events) {
		const diff = parseEditorFileDiff(event);
		if (!diff) {
			continue;
		}

		const existing = byPath.get(diff.path);
		if (!existing) {
			byPath.set(diff.path, diff);
			continue;
		}

		byPath.set(diff.path, {
			...existing,
			additions: existing.additions + diff.additions,
			deletions: existing.deletions + diff.deletions,
			hunks: [...existing.hunks, ...diff.hunks].slice(-30),
		});
	}

	return Array.from(byPath.values());
}

export function summarizeFileDiffs(
	fileDiffs: SessionFileDiff[],
): SessionDiffSummary {
	return fileDiffs.reduce(
		(acc, fileDiff) => {
			acc.additions += fileDiff.additions;
			acc.deletions += fileDiff.deletions;
			return acc;
		},
		{ ...EMPTY_DIFF_SUMMARY },
	);
}

export function buildSessionDiffState(
	events: SessionHookEvent[],
): SessionDiffState {
	const fileDiffs = mergeEditorDiffs(events);
	return {
		fileDiffs,
		summary: summarizeFileDiffs(fileDiffs),
	};
}
