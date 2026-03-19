import { formatHumanReadableDate } from "@clinebot/shared";
import { Box, render, Text, useInput } from "ink";
import React, { useMemo, useState } from "react";
import { formatUsd, writeln } from "../utils/output";
import { deleteSession, updateSession } from "../utils/session";
import {
	type HistoryListRow,
	listHistoryRows,
} from "../utils/session-history-rows";
import type { CliOutputMode } from "../utils/types";

export function formatHistoryListLine(row: HistoryListRow): string {
	const sessionId = row.session_id?.trim() || "(unknown-session)";
	const title =
		row.metadata?.title?.trim() || row.prompt?.trim() || "(no-title)";
	const cost = formatUsd(row.metadata?.totalCost ?? 0);
	const provider = row.provider?.trim() || "(unknown-provider)";
	const model = row.model?.trim() || "(unknown-model)";
	const date = formatHumanReadableDate(row.started_at);
	return `${date} - ${sessionId} - ${title} - ${cost} - ${provider} - ${model}`;
}

type HistoryIo = {
	writeln: (text?: string) => void;
	writeErr: (text: string) => void;
};

async function runHistoryDelete(
	rawArgs: string[],
	outputMode: CliOutputMode,
	io: HistoryIo,
): Promise<number> {
	const idIndex = rawArgs.indexOf("--session-id");
	const sessionId =
		idIndex >= 0 && idIndex + 1 < rawArgs.length
			? rawArgs[idIndex + 1]?.trim()
			: undefined;

	if (!sessionId) {
		io.writeErr("history delete requires --session-id <id>");
		return 1;
	}

	try {
		const result = await deleteSession(sessionId);
		if (outputMode === "json") {
			process.stdout.write(JSON.stringify(result));
			return result.deleted ? 0 : 1;
		}
		if (result.deleted) {
			io.writeln(`Deleted session ${sessionId}`);
			return 0;
		}
		io.writeErr(`Session ${sessionId} not found`);
		return 1;
	} catch (error) {
		io.writeErr(error instanceof Error ? error.message : String(error));
		return 1;
	}
}

async function runHistoryUpdate(
	rawArgs: string[],
	outputMode: CliOutputMode,
	io: HistoryIo,
): Promise<number> {
	const idIndex = rawArgs.indexOf("--session-id");
	const sessionId =
		idIndex >= 0 && idIndex + 1 < rawArgs.length
			? rawArgs[idIndex + 1]?.trim()
			: undefined;

	if (!sessionId) {
		io.writeErr("history update requires --session-id <id>");
		return 1;
	}

	const promptIndex = rawArgs.indexOf("--prompt");
	const prompt =
		promptIndex >= 0 && promptIndex + 1 < rawArgs.length
			? rawArgs[promptIndex + 1]?.trim()
			: undefined;

	const metadataIndex = rawArgs.indexOf("--metadata");
	const metadataStr =
		metadataIndex >= 0 && metadataIndex + 1 < rawArgs.length
			? rawArgs[metadataIndex + 1]?.trim()
			: undefined;

	const titleIndex = rawArgs.indexOf("--title");
	const title =
		titleIndex >= 0 && titleIndex + 1 < rawArgs.length
			? rawArgs[titleIndex + 1]?.trim()
			: undefined;

	let metadata: Record<string, unknown> | undefined;
	if (metadataStr) {
		try {
			metadata = JSON.parse(metadataStr);
		} catch (error) {
			io.writeErr(
				`Invalid metadata JSON: ${error instanceof Error ? error.message : String(error)}`,
			);
			return 1;
		}
	}
	if (title !== undefined) {
		if (metadata) {
			delete metadata.title;
		}
	}
	if (metadata && Object.keys(metadata).length === 0) {
		metadata = undefined;
	}

	if (prompt === undefined && metadata === undefined && title === undefined) {
		io.writeErr(
			"history update requires --prompt <text>, --title <text>, or --metadata <json>",
		);
		return 1;
	}

	try {
		const result = await updateSession(sessionId, { prompt, metadata, title });
		if (outputMode === "json") {
			process.stdout.write(JSON.stringify(result));
			return result.updated ? 0 : 1;
		}
		if (result.updated) {
			io.writeln(`Updated session ${sessionId}`);
			return 0;
		}
		io.writeErr(`Session ${sessionId} not found`);
		return 1;
	} catch (error) {
		io.writeErr(error instanceof Error ? error.message : String(error));
		return 1;
	}
}

interface HistoryListViewProps {
	rows: HistoryListRow[];
	onSelect: (sessionId: string) => void;
	onExit: () => void;
}

function HistoryListView({ rows, onSelect, onExit }: HistoryListViewProps) {
	const [selectedIndex, setSelectedIndex] = useState(0);
	const pageSize = Math.max(1, (process.stdout.rows ?? 24) / 4); // Leave room for header and footer

	const visibleWindow = useMemo(() => {
		const start = Math.max(0, selectedIndex - Math.floor(pageSize / 2));
		const end = Math.min(rows.length, start + pageSize);
		const adjustedStart = Math.max(0, end - pageSize);
		return {
			items: rows.slice(adjustedStart, end),
			startIndex: adjustedStart,
		};
	}, [rows, selectedIndex, pageSize]);

	useInput((input, key) => {
		if (key.upArrow) {
			setSelectedIndex((prev) => (prev > 0 ? prev - 1 : rows.length - 1));
		} else if (key.downArrow) {
			setSelectedIndex((prev) => (prev < rows.length - 1 ? prev + 1 : 0));
		} else if (key.return) {
			const selected = rows[selectedIndex];
			if (selected?.session_id) {
				onSelect(selected.session_id);
			}
		} else if (key.escape || (key.ctrl && input === "c")) {
			onExit();
		}
	});

	return React.createElement(
		Box,
		{ flexDirection: "column", padding: 1 },
		React.createElement(
			Text,
			{ bold: true, color: "cyan" },
			"Session History (Up/Down to navigate, Enter to continue, Esc to quit)",
		),
		React.createElement(
			Box,
			{ flexDirection: "column", marginTop: 1 },
			visibleWindow.items.map((row, index) => {
				const absoluteIndex = visibleWindow.startIndex + index;
				const isSelected = absoluteIndex === selectedIndex;
				return React.createElement(
					Text,
					{
						key: row.session_id ?? absoluteIndex,
						color: isSelected ? "blue" : undefined,
						inverse: isSelected,
					},
					`${isSelected ? "❯" : " "} ${formatHistoryListLine(row)}`,
				);
			}),
		),
		rows.length > pageSize &&
			React.createElement(
				Text,
				{ color: "gray" },
				`\nShowing ${visibleWindow.startIndex + 1}-${Math.min(visibleWindow.startIndex + pageSize, rows.length)} of ${rows.length}`,
			),
	);
}

export async function runHistoryCommand(input: {
	rawArgs: string[];
	outputMode: CliOutputMode;
	io?: HistoryIo;
}): Promise<number | string> {
	const io = input.io ?? {
		writeln,
		writeErr: (text: string) => process.stderr.write(`${text}\n`),
	};
	const subcommand = input.rawArgs[1]?.trim().toLowerCase();
	if (subcommand === "delete") {
		return await runHistoryDelete(input.rawArgs, input.outputMode, io);
	}
	if (subcommand === "update") {
		return await runHistoryUpdate(input.rawArgs, input.outputMode, io);
	}

	const limitIndex = input.rawArgs.indexOf("--limit");
	const limit =
		limitIndex >= 0 && limitIndex + 1 < input.rawArgs.length
			? Number.parseInt(input.rawArgs[limitIndex + 1] ?? "200", 10)
			: 200;

	const hydratedRows = await listHistoryRows(
		Number.isFinite(limit) ? limit : 200,
	);
	if (hydratedRows.length === 0) {
		if (input.outputMode === "json") {
			process.stdout.write(JSON.stringify([]));
		} else {
			writeln("No history found.");
		}
		return 0;
	}

	if (input.outputMode === "json") {
		process.stdout.write(JSON.stringify(hydratedRows));
		return 0;
	}

	// Interactive selection mode
	return new Promise((resolve) => {
		const { unmount } = render(
			React.createElement(HistoryListView, {
				rows: hydratedRows,
				onSelect: (sessionId) => {
					unmount();
					resolve(sessionId);
				},
				onExit: () => {
					unmount();
					resolve(0);
				},
			}),
		);
	});
}
