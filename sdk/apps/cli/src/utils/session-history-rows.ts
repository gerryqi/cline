import { createDefaultCliSessionManager, listSessions } from "./session";
import {
	inferProviderAndModelFromMessages,
	inferTitleFromMessages,
	summarizeCostFromMessages,
} from "./session-message-summary";

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

export async function hydrateHistoryRows(
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

export async function listHistoryRows(limit = 200): Promise<HistoryListRow[]> {
	const rows = (await listSessions(Math.max(1, Math.floor(limit)))) as
		| HistoryListRow[]
		| undefined;
	if (!rows || rows.length === 0) {
		return [];
	}
	return await hydrateHistoryRows(rows);
}
