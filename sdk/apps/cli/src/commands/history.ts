import { Box, render, Text, useInput } from "ink";
import React, { useMemo, useState } from "react";
import { formatUsd, writeln } from "../utils/output";
import { createDefaultCliSessionManager, listSessions } from "../utils/session";
import {
	inferProviderAndModelFromMessages,
	inferTitleFromMessages,
	summarizeCostFromMessages,
} from "../utils/session-message-summary";
import type { CliOutputMode } from "../utils/types";

export type HistoryListRow = {
	session_id?: string;
	provider?: string;
	model?: string;
	started_at?: string;
	prompt?: string;
	metadata?: {
		title?: string;
		totalCost?: number;
	};
};

function formatDate(dateStr?: string): string {
	if (!dateStr) return "(unknown-date)";
	const date = new Date(dateStr);
	if (Number.isNaN(date.getTime())) return dateStr;
	return date.toLocaleString("en-US", {
		year: "numeric",
		month: "numeric",
		day: "numeric",
		hour: "numeric",
		minute: "numeric",
		second: "numeric",
		hour12: true,
	});
}

export function formatHistoryListLine(row: HistoryListRow): string {
	const sessionId = row.session_id?.trim() || "(unknown-session)";
	const title =
		row.metadata?.title?.trim() || row.prompt?.trim() || "(no-title)";
	const cost = formatUsd(row.metadata?.totalCost ?? 0);
	const provider = row.provider?.trim() || "(unknown-provider)";
	const model = row.model?.trim() || "(unknown-model)";
	const date = formatDate(row.started_at);
	return `${date} - ${sessionId} - ${title} - ${cost} - ${provider} - ${model}`;
}

async function hydrateHistoryRows(
	rows: HistoryListRow[],
): Promise<HistoryListRow[]> {
	if (rows.length === 0) {
		return rows;
	}
	const sessionManager = await createDefaultCliSessionManager();
	try {
		return await Promise.all(
			rows.map(async (row) => {
				const sessionId = row.session_id?.trim();
				if (!sessionId) {
					return row;
				}
				const hasTitle = Boolean(
					row.metadata?.title?.trim() || row.prompt?.trim(),
				);
				const hasProvider = Boolean(row.provider?.trim());
				const hasModel = Boolean(row.model?.trim());
				const knownCost = row.metadata?.totalCost;
				const hasCost =
					typeof knownCost === "number" &&
					Number.isFinite(knownCost) &&
					knownCost > 0;
				if (hasTitle && hasProvider && hasModel && hasCost) {
					return row;
				}
				const messages = await sessionManager.readMessages(sessionId);
				if (messages.length === 0) {
					return row;
				}
				const inferredTitle = hasTitle
					? undefined
					: inferTitleFromMessages(messages);
				const inferredUsageCost = summarizeCostFromMessages(messages);
				const inferredProviderModel =
					inferProviderAndModelFromMessages(messages);
				return {
					...row,
					prompt: row.prompt?.trim() || inferredTitle || row.prompt,
					provider: row.provider?.trim() || inferredProviderModel.provider,
					model: row.model?.trim() || inferredProviderModel.model,
					metadata: {
						...(row.metadata ?? {}),
						title: row.metadata?.title?.trim() || inferredTitle,
						totalCost:
							hasCost || inferredUsageCost <= 0
								? row.metadata?.totalCost
								: inferredUsageCost,
					},
				};
			}),
		);
	} finally {
		await sessionManager.dispose().catch(() => {});
	}
}

interface HistoryListViewProps {
	rows: HistoryListRow[];
	onSelect: (sessionId: string) => void;
	onExit: () => void;
}

function HistoryListView({ rows, onSelect, onExit }: HistoryListViewProps) {
	const [selectedIndex, setSelectedIndex] = useState(0);
	const pageSize = Math.max(1, (process.stdout.rows ?? 24) - 10); // Leave room for header and footer

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
}): Promise<number | string> {
	const limitIndex = input.rawArgs.indexOf("--limit");
	const limit =
		limitIndex >= 0 && limitIndex + 1 < input.rawArgs.length
			? Number.parseInt(input.rawArgs[limitIndex + 1] ?? "200", 10)
			: 200;

	const rows = (await listSessions(Number.isFinite(limit) ? limit : 200)) as
		| HistoryListRow[]
		| undefined;

	if (!rows || rows.length === 0) {
		if (input.outputMode === "json") {
			process.stdout.write(JSON.stringify([]));
		} else {
			writeln("No history found.");
		}
		return 0;
	}

	const hydratedRows = await hydrateHistoryRows(rows);

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
