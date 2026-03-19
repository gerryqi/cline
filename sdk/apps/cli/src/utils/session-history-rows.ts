import { createDefaultCliSessionManager, listSessions } from "./session";
import { readSessionManifestTitle } from "./session-manifest-title";
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
				const manifestTitle = readSessionManifestTitle(sessionId);
				const rowMetadata = row.metadata ? { ...row.metadata } : undefined;
				if (rowMetadata) {
					delete rowMetadata.title;
				}
				const nextRow = manifestTitle
					? {
							...row,
							metadata: {
								...(rowMetadata ?? {}),
								title: manifestTitle,
							},
						}
					: rowMetadata
						? { ...row, metadata: rowMetadata }
						: row;
				const hasTitle = Boolean(manifestTitle || nextRow.prompt?.trim());
				const hasProvider = Boolean(nextRow.provider?.trim());
				const hasModel = Boolean(nextRow.model?.trim());
				const knownCost = nextRow.metadata?.totalCost;
				const hasCost =
					typeof knownCost === "number" &&
					Number.isFinite(knownCost) &&
					knownCost > 0;
				if (hasTitle && hasProvider && hasModel && hasCost) {
					return nextRow;
				}
				const messages = await sessionManager.readMessages(sessionId);
				if (messages.length === 0) {
					return nextRow;
				}
				const inferredTitle = hasTitle
					? undefined
					: inferTitleFromMessages(messages);
				const inferredUsageCost = summarizeCostFromMessages(messages);
				const inferredProviderModel =
					inferProviderAndModelFromMessages(messages);
				return {
					...nextRow,
					prompt: nextRow.prompt?.trim() || inferredTitle || nextRow.prompt,
					provider: nextRow.provider?.trim() || inferredProviderModel.provider,
					model: nextRow.model?.trim() || inferredProviderModel.model,
					metadata: {
						...(nextRow.metadata ?? {}),
						title: manifestTitle || inferredTitle,
						totalCost:
							hasCost || inferredUsageCost <= 0
								? nextRow.metadata?.totalCost
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
