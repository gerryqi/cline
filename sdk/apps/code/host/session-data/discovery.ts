import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname } from "node:path";
import {
	readSessionManifest,
	resolveCliEntrypointPath,
	sharedSessionDataDir,
} from "../paths";
import type { HostContext, JsonRecord } from "../types";
import {
	compareSessionRecordsByStartedAtDesc,
	derivePromptFromMessages,
	resolveSessionListTitle,
} from "./common";
import { readPersistedChatMessages } from "./messages";

export function discoverCliSessions(ctx: HostContext, limit = 300): unknown[] {
	const cliEntrypoint = resolveCliEntrypointPath(ctx);
	if (!cliEntrypoint) {
		return [];
	}
	const result = spawnSync(
		"bun",
		["run", cliEntrypoint, "history", "--json", "--limit", String(limit)],
		{
			cwd: dirname(dirname(cliEntrypoint)),
			encoding: "utf8",
		},
	);
	if (result.status !== 0) {
		throw new Error(result.stderr.trim() || "failed to list cli sessions");
	}
	const parsed = JSON.parse(result.stdout) as unknown[];
	if (!Array.isArray(parsed)) {
		return [];
	}
	return parsed
		.filter((item): item is JsonRecord =>
			Boolean(item && typeof item === "object"),
		)
		.map((item) => {
			const sessionId = String(item.sessionId ?? item.session_id ?? "").trim();
			const prompt = typeof item.prompt === "string" ? item.prompt : undefined;
			const metadata =
				item.metadata && typeof item.metadata === "object"
					? ({ ...(item.metadata as JsonRecord) } as JsonRecord)
					: undefined;
			const resolvedTitle = resolveSessionListTitle({
				sessionId,
				metadata,
				prompt,
			});
			return {
				...item,
				sessionId,
				metadata: {
					...(metadata ?? {}),
					title: resolvedTitle,
				},
			};
		})
		.sort(compareSessionRecordsByStartedAtDesc)
		.slice(0, Math.max(1, limit));
}

export function discoverChatSessions(ctx: HostContext, limit = 300): unknown[] {
	const out: JsonRecord[] = [];
	for (const [sessionId, session] of ctx.liveSessions.entries()) {
		if (!session.busy && !session.prompt && session.messages.length === 0) {
			continue;
		}
		const prompt = session.prompt ?? derivePromptFromMessages(session.messages);
		const resolvedTitle = resolveSessionListTitle({
			sessionId,
			metadata: session.title ? { title: session.title } : undefined,
			prompt,
			messages: session.messages,
		});
		out.push({
			sessionId,
			status: session.status,
			provider: session.config.provider ?? "",
			model: session.config.model ?? "",
			cwd: session.config.cwd ?? session.config.workspaceRoot ?? "",
			workspaceRoot: session.config.workspaceRoot ?? "",
			prompt,
			startedAt: String(session.startedAt),
			endedAt: session.endedAt ? String(session.endedAt) : undefined,
			metadata: { title: resolvedTitle },
		});
	}

	const base = sharedSessionDataDir();
	if (existsSync(base)) {
		for (const entry of readdirSync(base, { withFileTypes: true })) {
			if (!entry.isDirectory()) {
				continue;
			}
			const sessionId = entry.name.trim();
			if (!sessionId || out.some((item) => item.sessionId === sessionId)) {
				continue;
			}
			const manifest = readSessionManifest(sessionId) ?? {};
			const isDesktopChat =
				manifest.source === "desktop-chat" || sessionId.startsWith("chat_");
			if (!isDesktopChat) {
				continue;
			}
			const messages = readPersistedChatMessages(sessionId) ?? [];
			if (messages.length === 0) {
				continue;
			}
			const metadata =
				manifest.metadata && typeof manifest.metadata === "object"
					? { ...(manifest.metadata as JsonRecord) }
					: undefined;
			const prompt = derivePromptFromMessages(messages);
			const resolvedTitle = resolveSessionListTitle({
				sessionId,
				metadata,
				prompt,
				messages,
			});
			out.push({
				sessionId,
				status: "completed",
				provider: manifest.provider ?? "unknown",
				model: manifest.model ?? "unknown",
				cwd: manifest.cwd ?? "",
				workspaceRoot:
					manifest.workspace_root ??
					manifest.workspaceRoot ??
					manifest.cwd ??
					"",
				prompt,
				startedAt: String(
					manifest.started_at ?? manifest.startedAt ?? Date.now(),
				),
				endedAt: String(manifest.ended_at ?? manifest.endedAt ?? Date.now()),
				metadata: {
					...(metadata ?? {}),
					title: resolvedTitle,
				},
			});
		}
	}

	out.sort(compareSessionRecordsByStartedAtDesc);
	return out.slice(0, Math.max(1, limit));
}

export function mergeDiscoveredSessionLists(
	chat: unknown[],
	cli: unknown[],
	limit: number,
): unknown[] {
	const merged = new Map<string, unknown>();
	for (const item of [...chat, ...cli]) {
		if (!item || typeof item !== "object") {
			continue;
		}
		const sessionId = String(
			(item as JsonRecord).sessionId ?? (item as JsonRecord).session_id ?? "",
		).trim();
		if (!sessionId || merged.has(sessionId)) {
			continue;
		}
		const normalized = item as JsonRecord;
		merged.set(sessionId, {
			...normalized,
			sessionId,
			startedAt:
				normalized.startedAt ?? normalized.started_at ?? String(Date.now()),
			endedAt: normalized.endedAt ?? normalized.ended_at,
			workspaceRoot:
				normalized.workspaceRoot ??
				normalized.workspace_root ??
				normalized.cwd ??
				"",
		});
	}
	return Array.from(merged.values())
		.sort((left, right) =>
			compareSessionRecordsByStartedAtDesc(
				left as JsonRecord,
				right as JsonRecord,
			),
		)
		.slice(0, limit);
}
