import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { getFileIndex } from "@clinebot/core/node";
import {
	findArtifactUnderDir,
	readSessionManifest,
	resolveCliEntrypointPath,
	rootSessionIdFrom,
	sessionHookLogPath,
	sessionLogPath,
	sharedSessionDataDir,
	sharedSessionHookPath,
	sharedSessionLogPath,
	sharedSessionMessagesPath,
	sharedSessionMessagesWritePath,
	writeSessionManifest,
} from "./paths";
import { nowMs, sendEvent } from "./state";
import type { ChatTurnResult, HostContext, JsonRecord } from "./types";

export function appendSessionChunk(
	sessionId: string,
	stream: string,
	chunk: string,
	ts: number,
) {
	const path = sessionLogPath(sessionId);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify({ ts, stream, chunk })}\n`, {
		flag: "a",
	});
}

export function emitChunk(
	ctx: HostContext,
	sessionId: string,
	stream: string,
	chunk: string,
) {
	const ts = nowMs();
	appendSessionChunk(sessionId, stream, chunk, ts);
	sendEvent(ctx, "chat_event", {
		sessionId,
		stream,
		chunk,
		ts,
	});
}

export function normalizeSessionTitle(
	title?: string | null,
): string | undefined {
	const trimmed = title?.trim();
	return trimmed ? trimmed.slice(0, 120) : undefined;
}

export function parseTimestamp(value?: string | number | null): number {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	const trimmed = typeof value === "string" ? value.trim() : "";
	if (!trimmed) {
		return Number.NEGATIVE_INFINITY;
	}
	const maybeEpoch = Number(trimmed);
	if (Number.isFinite(maybeEpoch)) {
		if (/^\d{10}$/.test(trimmed)) {
			return maybeEpoch * 1000;
		}
		return maybeEpoch;
	}
	const parsed = new Date(trimmed).getTime();
	return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

export function compareSessionRecordsByStartedAtDesc(
	left: JsonRecord,
	right: JsonRecord,
): number {
	const timeDelta =
		parseTimestamp(right.startedAt as string | number | undefined) -
		parseTimestamp(left.startedAt as string | number | undefined);
	if (timeDelta !== 0) {
		return timeDelta;
	}
	const leftId = String(left.sessionId ?? "");
	const rightId = String(right.sessionId ?? "");
	return rightId.localeCompare(leftId);
}

export function stringifyMessageContent(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}
	if (Array.isArray(value)) {
		const parts: string[] = [];
		for (const block of value) {
			if (typeof block === "string") {
				if (block.trim()) {
					parts.push(block);
				}
				continue;
			}
			if (!block || typeof block !== "object") {
				continue;
			}
			const record = block as JsonRecord;
			const blockType = typeof record.type === "string" ? record.type : "";
			const piece =
				blockType === "text"
					? String(record.text ?? "")
					: blockType === "thinking"
						? String(record.thinking ?? "")
						: blockType === "tool_use"
							? `[tool] ${String(record.name ?? "tool_call")}`
							: blockType === "tool_result"
								? `[tool_result]\n${stringifyMessageContent(record.content)}`
								: blockType === "image"
									? "[image]"
									: blockType === "redacted_thinking"
										? "[redacted_thinking]"
										: typeof record.text === "string"
											? record.text
											: "";
			if (piece.trim()) {
				parts.push(piece);
			}
		}
		return parts.join("\n");
	}
	if (value && typeof value === "object") {
		const record = value as JsonRecord;
		if (typeof record.text === "string") {
			return record.text;
		}
	}
	return "";
}

function titleFromPrompt(prompt?: string | null): string | undefined {
	const normalized = normalizeSessionTitle(prompt ?? undefined);
	if (!normalized) {
		return undefined;
	}
	return normalized.split("\n")[0]?.trim().slice(0, 70) || undefined;
}

function titleFromMessages(messages: unknown[]): string | undefined {
	for (const role of ["user", "assistant"] as const) {
		for (const rawMessage of messages) {
			if (!rawMessage || typeof rawMessage !== "object") {
				continue;
			}
			const message = rawMessage as JsonRecord;
			if (message.role !== role) {
				continue;
			}
			const text = normalizeSessionTitle(
				stringifyMessageContent(message.content),
			);
			if (!text) {
				continue;
			}
			return text.split("\n")[0]?.trim().slice(0, 70) || undefined;
		}
	}
	return undefined;
}

export function derivePromptFromMessages(
	messages: unknown[],
): string | undefined {
	for (const message of messages) {
		if (!message || typeof message !== "object") {
			continue;
		}
		const record = message as JsonRecord;
		if (record.role !== "user") {
			continue;
		}
		const content = stringifyMessageContent(record.content);
		if (content.trim()) {
			return content.trim();
		}
	}
	return undefined;
}

export function resolveSessionListTitle(options: {
	sessionId: string;
	metadata?: unknown;
	prompt?: string | null;
	messages?: unknown[];
}): string {
	const metadataTitle =
		options.metadata && typeof options.metadata === "object"
			? normalizeSessionTitle(
					(options.metadata as JsonRecord).title as string | undefined,
				)
			: undefined;
	if (metadataTitle) {
		return metadataTitle.slice(0, 70);
	}
	const promptTitle = titleFromPrompt(options.prompt);
	if (promptTitle) {
		return promptTitle;
	}
	const messageTitle = options.messages
		? titleFromMessages(options.messages)
		: undefined;
	if (messageTitle) {
		return messageTitle;
	}
	return `Session ${options.sessionId.slice(-6)}`;
}

export function readSessionMetadataTitle(
	sessionId: string,
): string | undefined {
	const metadata = readSessionManifest(sessionId)?.metadata;
	if (!metadata || typeof metadata !== "object") {
		return undefined;
	}
	return normalizeSessionTitle(
		(metadata as JsonRecord).title as string | undefined,
	);
}

export function readPersistedChatMessages(sessionId: string): unknown[] | null {
	const path = sharedSessionMessagesPath(sessionId);
	if (!existsSync(path)) {
		return null;
	}
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as
			| { messages?: unknown[] }
			| unknown[];
		if (Array.isArray(parsed)) {
			return parsed;
		}
		return Array.isArray(parsed.messages) ? parsed.messages : [];
	} catch {
		return null;
	}
}

function parseU64Value(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
		return Math.trunc(value);
	}
	if (typeof value === "string") {
		const parsed = Number.parseInt(value, 10);
		if (Number.isFinite(parsed) && parsed >= 0) {
			return parsed;
		}
	}
	return undefined;
}

function parseF64Value(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
		return value;
	}
	if (typeof value === "string") {
		const parsed = Number.parseFloat(value);
		if (Number.isFinite(parsed) && parsed >= 0) {
			return parsed;
		}
	}
	return undefined;
}

function extractMessageUsageMeta(message: JsonRecord): JsonRecord | undefined {
	const metrics =
		message.metrics && typeof message.metrics === "object"
			? (message.metrics as JsonRecord)
			: undefined;
	const modelInfo =
		message.modelInfo && typeof message.modelInfo === "object"
			? (message.modelInfo as JsonRecord)
			: undefined;
	const inputTokens = parseU64Value(metrics?.inputTokens);
	const outputTokens = parseU64Value(metrics?.outputTokens);
	const totalCost = parseF64Value(metrics?.cost);
	const providerId =
		(typeof message.providerId === "string" && message.providerId) ||
		(typeof modelInfo?.provider === "string" ? modelInfo.provider : undefined);
	const modelId =
		(typeof message.modelId === "string" && message.modelId) ||
		(typeof modelInfo?.id === "string" ? modelInfo.id : undefined);
	if (
		inputTokens === undefined &&
		outputTokens === undefined &&
		totalCost === undefined &&
		!providerId &&
		!modelId
	) {
		return undefined;
	}
	return {
		inputTokens,
		outputTokens,
		totalCost,
		providerId,
		modelId,
	};
}

export function persistUsageInMessages(
	messages: unknown[],
	config: JsonRecord,
	result: ChatTurnResult,
): unknown[] {
	const next = [...messages];
	let assistantIndex = -1;
	for (let i = next.length - 1; i >= 0; i -= 1) {
		const item = next[i];
		if (!item || typeof item !== "object") {
			continue;
		}
		if ((item as JsonRecord).role === "assistant") {
			assistantIndex = i;
			break;
		}
	}
	if (assistantIndex < 0) {
		return next;
	}

	const assistantMessage = next[assistantIndex];
	if (!assistantMessage || typeof assistantMessage !== "object") {
		return next;
	}

	const record = { ...(assistantMessage as JsonRecord) };
	const metrics =
		record.metrics && typeof record.metrics === "object"
			? { ...(record.metrics as JsonRecord) }
			: {};
	const inputTokens = result.usage?.inputTokens ?? result.inputTokens;
	const outputTokens = result.usage?.outputTokens ?? result.outputTokens;
	const totalCost = result.usage?.totalCost ?? result.totalCost;
	if (typeof inputTokens === "number") {
		metrics.inputTokens = inputTokens;
	}
	if (typeof outputTokens === "number") {
		metrics.outputTokens = outputTokens;
	}
	if (
		typeof totalCost === "number" &&
		Number.isFinite(totalCost) &&
		totalCost >= 0
	) {
		metrics.cost = totalCost;
	}
	record.metrics = metrics;
	if (typeof config.provider === "string" && config.provider.trim()) {
		record.providerId = config.provider.trim();
	}
	if (typeof config.model === "string" && config.model.trim()) {
		record.modelId = config.model.trim();
	}
	const modelInfo =
		record.modelInfo && typeof record.modelInfo === "object"
			? { ...(record.modelInfo as JsonRecord) }
			: {};
	if (
		typeof config.model === "string" &&
		config.model.trim() &&
		!modelInfo.id
	) {
		modelInfo.id = config.model.trim();
	}
	if (
		typeof config.provider === "string" &&
		config.provider.trim() &&
		!modelInfo.provider
	) {
		modelInfo.provider = config.provider.trim();
	}
	record.modelInfo = modelInfo;
	if (!record.ts) {
		record.ts = nowMs();
	}
	next[assistantIndex] = record;
	return next;
}

function normalizeChatFinishStatus(status?: string): string {
	const normalized = status?.trim().toLowerCase() || "";
	if (!normalized) {
		return "completed";
	}
	if (
		normalized.includes("cancel") ||
		normalized.includes("abort") ||
		normalized.includes("interrupt")
	) {
		return "cancelled";
	}
	if (normalized.includes("fail") || normalized.includes("error")) {
		return "failed";
	}
	if (normalized.includes("run") || normalized.includes("start")) {
		return "running";
	}
	if (
		normalized.includes("complete") ||
		normalized.includes("done") ||
		normalized.includes("stop") ||
		normalized.includes("max_iteration") ||
		normalized.includes("max-iteration")
	) {
		return "completed";
	}
	return "idle";
}

function buildToolPayloadJson(
	toolName: string,
	input: unknown,
	result: unknown,
	isError: boolean,
): string {
	return JSON.stringify({
		toolName,
		input,
		result,
		isError,
	});
}

function normalizeRole(role: unknown): string {
	switch (role) {
		case "user":
		case "assistant":
		case "tool":
		case "system":
		case "status":
		case "error":
			return String(role);
		default:
			return "assistant";
	}
}

export async function readSessionMessages(
	ctx: HostContext,
	sessionId: string,
	maxMessages = 800,
): Promise<unknown[]> {
	const persisted = readPersistedChatMessages(sessionId);
	const messages =
		persisted && persisted.length > 0
			? persisted
			: (ctx.liveSessions.get(sessionId)?.messages ?? []);
	const max = Math.max(1, maxMessages);
	const start = Math.max(0, messages.length - max);
	const baseTs = nowMs() - messages.length;
	const out: JsonRecord[] = [];
	const pendingToolMessages = new Map<string, [number, string, unknown]>();

	for (let idx = start; idx < messages.length; idx += 1) {
		const rawMessage = messages[idx];
		if (!rawMessage || typeof rawMessage !== "object") {
			continue;
		}
		const message = rawMessage as JsonRecord;
		let textMeta = extractMessageUsageMeta(message);
		const role = normalizeRole(message.role);
		const createdAtBase = parseU64Value(message.ts) ?? baseTs + idx;
		const messageIdBase =
			(typeof message.id === "string" && message.id.trim()) ||
			`history_message_${idx}`;
		const contentBlocks = Array.isArray(message.content)
			? (message.content as unknown[])
			: null;

		if (!contentBlocks) {
			const content = stringifyMessageContent(message.content);
			if (!content.trim()) {
				continue;
			}
			out.push({
				id: messageIdBase,
				sessionId,
				role,
				content,
				createdAt: createdAtBase,
				meta: textMeta,
			});
			continue;
		}

		const textParts: string[] = [];
		let textSegmentIndex = 0;
		const outStartIndex = out.length;
		const flushTextParts = (ts: number) => {
			if (textParts.length === 0) {
				return;
			}
			const joined = textParts.join("\n");
			textParts.length = 0;
			if (!joined.trim()) {
				return;
			}
			out.push({
				id: `${messageIdBase}_text_${textSegmentIndex}`,
				sessionId,
				role,
				content: joined,
				createdAt: ts,
				meta: textMeta,
			});
			textSegmentIndex += 1;
			textMeta = undefined;
		};

		for (let blockIdx = 0; blockIdx < contentBlocks.length; blockIdx += 1) {
			const block = contentBlocks[blockIdx];
			const blockTs = createdAtBase + blockIdx;
			if (!block || typeof block !== "object") {
				const line = stringifyMessageContent(block);
				if (line.trim()) {
					textParts.push(line);
				}
				continue;
			}
			const record = block as JsonRecord;
			const blockType = typeof record.type === "string" ? record.type : "";
			if (blockType === "tool_use") {
				flushTextParts(blockTs);
				const toolName =
					typeof record.name === "string" ? record.name : "tool_call";
				const toolUseId = typeof record.id === "string" ? record.id : "";
				const input = record.input ?? null;
				const outIndex = out.length;
				out.push({
					id: `${messageIdBase}_tool_use_${blockIdx}`,
					sessionId,
					role: "tool",
					content: buildToolPayloadJson(toolName, input, null, false),
					createdAt: blockTs,
					meta: {
						toolName,
						hookEventName: "history_tool_use",
					},
				});
				if (toolUseId.trim()) {
					pendingToolMessages.set(toolUseId, [outIndex, toolName, input]);
				}
				continue;
			}
			if (blockType === "tool_result") {
				flushTextParts(blockTs);
				const toolUseId =
					typeof record.tool_use_id === "string" ? record.tool_use_id : "";
				const result = record.content ?? null;
				const isError = Boolean(record.is_error);
				const existing = pendingToolMessages.get(toolUseId);
				if (existing) {
					const [outIndex, toolName, input] = existing;
					const target = out[outIndex];
					if (target) {
						target.content = buildToolPayloadJson(
							toolName,
							input,
							result,
							isError,
						);
						target.meta = {
							toolName,
							hookEventName: "history_tool_result",
						};
					}
					pendingToolMessages.delete(toolUseId);
				} else {
					out.push({
						id: `${messageIdBase}_tool_result_${blockIdx}`,
						sessionId,
						role: "tool",
						content: buildToolPayloadJson("tool_result", null, result, isError),
						createdAt: blockTs,
						meta: {
							toolName: "tool_result",
							hookEventName: "history_tool_result",
						},
					});
				}
				continue;
			}
			const line = stringifyMessageContent(block);
			if (line.trim()) {
				textParts.push(line);
			}
		}

		flushTextParts(createdAtBase + contentBlocks.length);
		if (textMeta && out[outStartIndex]) {
			out[outStartIndex].meta = {
				...(typeof out[outStartIndex].meta === "object"
					? (out[outStartIndex].meta as JsonRecord)
					: {}),
				...textMeta,
			};
		}
	}

	return out;
}

export async function readSessionTranscript(
	sessionId: string,
	maxChars?: number,
): Promise<string> {
	const jsonlPath = sessionLogPath(sessionId);
	const sharedPath = sharedSessionLogPath(sessionId);
	if (!existsSync(jsonlPath) && !existsSync(sharedPath)) {
		return "";
	}
	const isJsonl = existsSync(jsonlPath);
	const raw = readFileSync(isJsonl ? jsonlPath : sharedPath, "utf8");
	let out = "";
	if (isJsonl) {
		for (const line of raw.split("\n")) {
			if (!line.trim()) {
				continue;
			}
			try {
				const parsed = JSON.parse(line) as { chunk?: string };
				if (typeof parsed.chunk === "string") {
					out += parsed.chunk;
				}
			} catch {
				// Ignore malformed lines.
			}
		}
	} else {
		out = raw;
	}
	if (typeof maxChars === "number" && maxChars > 0 && out.length > maxChars) {
		return out.slice(-maxChars);
	}
	return out;
}

export async function readSessionHooks(
	sessionId: string,
	limit = 300,
): Promise<unknown[]> {
	const path = existsSync(sessionHookLogPath(sessionId))
		? sessionHookLogPath(sessionId)
		: sharedSessionHookPath(sessionId);
	if (!existsSync(path)) {
		return [];
	}
	const raw = await readFile(path, "utf8");
	const out: JsonRecord[] = [];
	for (const line of raw.split("\n")) {
		if (!line.trim()) {
			continue;
		}
		try {
			const value = JSON.parse(line) as JsonRecord;
			const hookName =
				(typeof value.hookName === "string" && value.hookName) ||
				(typeof value.hook_event_name === "string" && value.hook_event_name) ||
				(typeof value.event === "string" && value.event) ||
				"";
			if (!hookName) {
				continue;
			}
			const usage =
				(value.turn &&
				typeof value.turn === "object" &&
				(value.turn as JsonRecord).usage &&
				typeof (value.turn as JsonRecord).usage === "object"
					? ((value.turn as JsonRecord).usage as JsonRecord)
					: undefined) ||
				(value.usage && typeof value.usage === "object"
					? (value.usage as JsonRecord)
					: undefined) ||
				(value.turn_usage && typeof value.turn_usage === "object"
					? (value.turn_usage as JsonRecord)
					: undefined);
			out.push({
				ts: typeof value.ts === "string" ? value.ts : "",
				hookName,
				agentId: value.agent_id,
				taskId: value.taskId ?? value.conversation_id,
				parentAgentId: value.parent_agent_id,
				iteration: parseU64Value(value.iteration),
				toolName:
					(value.tool_call &&
						typeof value.tool_call === "object" &&
						(value.tool_call as JsonRecord).name) ||
					(value.tool_result &&
						typeof value.tool_result === "object" &&
						(value.tool_result as JsonRecord).name),
				toolInput:
					(value.tool_call &&
						typeof value.tool_call === "object" &&
						(value.tool_call as JsonRecord).input) ||
					(value.tool_result &&
						typeof value.tool_result === "object" &&
						(value.tool_result as JsonRecord).input),
				toolOutput:
					value.tool_result && typeof value.tool_result === "object"
						? (value.tool_result as JsonRecord).output
						: undefined,
				toolError:
					value.tool_result && typeof value.tool_result === "object"
						? (value.tool_result as JsonRecord).error
						: undefined,
				inputTokens:
					parseU64Value(usage?.inputTokens) ??
					parseU64Value(usage?.input_tokens) ??
					parseU64Value(usage?.prompt_tokens),
				outputTokens:
					parseU64Value(usage?.outputTokens) ??
					parseU64Value(usage?.output_tokens) ??
					parseU64Value(usage?.completion_tokens),
				totalCost:
					parseF64Value(usage?.totalCost) ??
					parseF64Value(usage?.total_cost) ??
					parseF64Value(usage?.cost),
			});
		} catch {
			// Ignore malformed lines.
		}
	}
	return out.slice(-Math.max(1, limit));
}

export function discoverCliSessions(ctx: HostContext, limit = 300): unknown[] {
	const cliEntrypoint = resolveCliEntrypointPath(ctx);
	if (!cliEntrypoint) {
		return [];
	}
	const result = spawnSync(
		"bun",
		["run", cliEntrypoint, "sessions", "list", "--limit", String(limit)],
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
		const resolvedTitle = resolveSessionListTitle({
			sessionId,
			metadata: session.title ? { title: session.title } : undefined,
			prompt: session.prompt ?? derivePromptFromMessages(session.messages),
			messages: session.messages,
		});
		out.push({
			sessionId,
			status: session.status,
			provider: session.config.provider ?? "",
			model: session.config.model ?? "",
			cwd: session.config.cwd ?? session.config.workspaceRoot ?? "",
			workspaceRoot: session.config.workspaceRoot ?? "",
			prompt: session.prompt ?? derivePromptFromMessages(session.messages),
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
			const resolvedTitle = resolveSessionListTitle({
				sessionId,
				metadata,
				prompt: derivePromptFromMessages(messages),
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
				prompt: derivePromptFromMessages(messages),
				startedAt: String(manifest.started_at ?? manifest.startedAt ?? nowMs()),
				endedAt: String(manifest.ended_at ?? manifest.endedAt ?? nowMs()),
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
				normalized.startedAt ?? normalized.started_at ?? String(nowMs()),
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

export function searchWorkspaceFiles(
	ctx: HostContext,
	args?: Record<string, unknown>,
): Promise<string[]> {
	const root =
		typeof args?.workspaceRoot === "string" && args.workspaceRoot.trim()
			? args.workspaceRoot.trim()
			: ctx.workspaceRoot;
	const query =
		typeof args?.query === "string" ? args.query.trim().toLowerCase() : "";
	const limit =
		typeof args?.limit === "number" && Number.isFinite(args.limit)
			? Math.max(1, Math.min(50, Math.trunc(args.limit)))
			: 10;
	const rankPath = (path: string) => {
		if (!query) {
			return 3;
		}
		const lower = path.toLowerCase();
		if (lower.startsWith(query)) {
			return 0;
		}
		if (lower.includes(`/${query}`)) {
			return 1;
		}
		if (lower.includes(query)) {
			return 2;
		}
		return Number.POSITIVE_INFINITY;
	};
	return getFileIndex(root).then((index) =>
		Array.from(index)
			.sort((a, b) => a.localeCompare(b))
			.map((path) => ({ path, rank: rankPath(path) }))
			.filter((item) => Number.isFinite(item.rank))
			.sort((left, right) =>
				left.rank !== right.rank
					? left.rank - right.rank
					: left.path.localeCompare(right.path),
			)
			.slice(0, limit)
			.map((item) => item.path),
	);
}

export function persistSessionMessages(
	sessionId: string,
	persistedMessages: unknown[],
) {
	const writePath = sharedSessionMessagesWritePath(sessionId);
	mkdirSync(dirname(writePath), { recursive: true });
	writeFileSync(
		writePath,
		JSON.stringify(
			{
				messages: persistedMessages,
				ts: nowMs(),
			},
			null,
			2,
		),
	);
}

export function updateSessionTitle(sessionId: string, title?: string) {
	const existingManifest = readSessionManifest(sessionId) ?? {};
	writeSessionManifest(sessionId, {
		...existingManifest,
		metadata: {
			...(existingManifest.metadata &&
			typeof existingManifest.metadata === "object"
				? (existingManifest.metadata as JsonRecord)
				: {}),
			title,
		},
	});
}

export {
	findArtifactUnderDir,
	readSessionManifest,
	rootSessionIdFrom,
	sharedSessionDataDir,
	writeSessionManifest,
	normalizeChatFinishStatus,
};
