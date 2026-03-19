import { spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	unlinkSync,
	watch,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { setHomeDir, setHomeDirIfUnset } from "@clinebot/core";
import {
	toolApprovalDecisionPath,
	toolApprovalDir,
	toolApprovalRequestPrefix,
} from "./paths";
import {
	derivePromptFromMessages,
	emitChunk,
	normalizeChatFinishStatus,
	persistSessionMessages,
	persistUsageInMessages,
	readPersistedChatMessages,
	readSessionMetadataTitle,
} from "./session-data";
import { nowMs, sendEvent } from "./state";
import {
	type ChatSessionCommandRequest,
	type ChatTurnResult,
	DEFAULT_RPC_CLIENT_ID,
	DEFAULT_RPC_CLIENT_TYPE,
	type HostContext,
	type JsonRecord,
	type ToolApprovalRequestItem,
} from "./types";

function setRuntimeHomeDir(config: unknown) {
	if (!config || typeof config !== "object") {
		setHomeDirIfUnset(homedir());
		return;
	}
	const sessions = (config as JsonRecord).sessions;
	const homeDir =
		sessions && typeof sessions === "object"
			? ((sessions as JsonRecord).homeDir as string | undefined)
			: undefined;
	const normalized = homeDir?.trim();
	if (normalized) {
		setHomeDir(normalized);
		return;
	}
	setHomeDirIfUnset(homedir());
}

function addRuntimeLoggerContext(config: unknown) {
	if (!config || typeof config !== "object") {
		return;
	}
	const record = config as JsonRecord;
	const existing =
		record.logger && typeof record.logger === "object"
			? { ...(record.logger as JsonRecord) }
			: {};
	const bindings =
		existing.bindings && typeof existing.bindings === "object"
			? { ...(existing.bindings as JsonRecord) }
			: {};
	record.logger = {
		...existing,
		name:
			(typeof existing.name === "string" && existing.name.trim()) ||
			"clite.code",
		bindings: {
			...bindings,
			clientId: DEFAULT_RPC_CLIENT_ID,
			clientType: DEFAULT_RPC_CLIENT_TYPE,
			clientApp: "code",
		},
	};
}

function resolveChatRuntimeBridgeScriptPath(ctx: HostContext): string | null {
	const candidates = [
		join(
			ctx.workspaceRoot,
			"apps",
			"code",
			"scripts",
			"chat-runtime-bridge.ts",
		),
		join(
			ctx.workspaceRoot,
			"packages",
			"app",
			"scripts",
			"chat-runtime-bridge.ts",
		),
		join(ctx.workspaceRoot, "app", "scripts", "chat-runtime-bridge.ts"),
		join(process.cwd(), "app", "scripts", "chat-runtime-bridge.ts"),
		join(process.cwd(), "..", "scripts", "chat-runtime-bridge.ts"),
		join(process.cwd(), "scripts", "chat-runtime-bridge.ts"),
	];
	return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function readChildLines(
	stream: NodeJS.ReadableStream,
	onLine: (line: string) => void,
) {
	let buffer = "";
	stream.on("data", (chunk) => {
		buffer += String(chunk);
		let newlineIndex = buffer.indexOf("\n");
		while (newlineIndex >= 0) {
			const line = buffer.slice(0, newlineIndex).trim();
			buffer = buffer.slice(newlineIndex + 1);
			if (line) {
				onLine(line);
			}
			newlineIndex = buffer.indexOf("\n");
		}
	});
}

export function ensureBridgeStarted(ctx: HostContext) {
	if (ctx.bridgeChild && ctx.bridgeChild.exitCode === null && ctx.bridgeReady) {
		return;
	}
	const scriptPath = resolveChatRuntimeBridgeScriptPath(ctx);
	if (!scriptPath) {
		throw new Error("chat runtime bridge script not found");
	}
	ctx.bridgeReady = false;
	mkdirSync(toolApprovalDir(), { recursive: true });
	ctx.bridgeChild = spawn("bun", [scriptPath], {
		cwd: ctx.workspaceRoot,
		env: {
			...process.env,
			CLINE_TOOL_APPROVAL_MODE: "desktop",
			CLINE_TOOL_APPROVAL_DIR: toolApprovalDir(),
			CLINE_RPC_CLIENT_ID: DEFAULT_RPC_CLIENT_ID,
			CLINE_RPC_CLIENT_TYPE: DEFAULT_RPC_CLIENT_TYPE,
			CLINE_RPC_CLIENT_APP: "code",
		},
		stdio: ["pipe", "pipe", "pipe"],
	});
	readChildLines(ctx.bridgeChild.stdout, (line) => {
		const parsed = JSON.parse(line) as JsonRecord;
		const type = String(parsed.type ?? "");
		if (type === "ready") {
			ctx.bridgeReady = true;
			return;
		}
		if (type === "response") {
			const requestId = String(parsed.requestId ?? "");
			const pending = ctx.pendingBridge.get(requestId);
			if (!pending) {
				return;
			}
			ctx.pendingBridge.delete(requestId);
			if (typeof parsed.error === "string" && parsed.error.trim()) {
				pending.reject(new Error(parsed.error));
				return;
			}
			pending.resolve(parsed.response ?? null);
			return;
		}
		if (type === "chat_text") {
			emitChunk(
				ctx,
				String(parsed.sessionId ?? ""),
				"chat_text",
				String(parsed.chunk ?? ""),
			);
			return;
		}
		if (type === "tool_call_start") {
			emitChunk(
				ctx,
				String(parsed.sessionId ?? ""),
				"chat_tool_call_start",
				JSON.stringify({
					toolCallId: parsed.toolCallId,
					toolName: parsed.toolName,
					input: parsed.input,
				}),
			);
			return;
		}
		if (type === "tool_call_end") {
			emitChunk(
				ctx,
				String(parsed.sessionId ?? ""),
				"chat_tool_call_end",
				JSON.stringify({
					toolCallId: parsed.toolCallId,
					toolName: parsed.toolName,
					output: parsed.output,
					error: parsed.error,
					durationMs: parsed.durationMs,
				}),
			);
			return;
		}
		if (type === "error") {
			const sessionId =
				typeof parsed.sessionId === "string" ? parsed.sessionId : "";
			const message =
				typeof parsed.message === "string"
					? parsed.message
					: "chat runtime bridge error";
			if (sessionId) {
				emitChunk(
					ctx,
					sessionId,
					"chat_core_log",
					JSON.stringify({
						level: "error",
						message,
					}),
				);
				return;
			}
			console.error("[chat-runtime-bridge]", message);
		}
	});
	readChildLines(ctx.bridgeChild.stderr, (line) => {
		console.error("[chat-runtime-bridge]", line);
	});
	ctx.bridgeChild.on("exit", () => {
		ctx.bridgeReady = false;
		ctx.bridgeChild = null;
		for (const [requestId, pending] of ctx.pendingBridge.entries()) {
			ctx.pendingBridge.delete(requestId);
			pending.reject(new Error("chat runtime bridge exited"));
		}
	});
}

export async function runBridgeCommand(
	ctx: HostContext,
	command: Record<string, unknown>,
): Promise<unknown> {
	ensureBridgeStarted(ctx);
	const child = ctx.bridgeChild;
	if (!child || !child.stdin) {
		throw new Error("chat runtime bridge unavailable");
	}
	const requestId = `bridge_${ctx.bridgeRequestId++}`;
	const envelope = JSON.stringify({
		type: "request",
		requestId,
		command,
	});
	return await new Promise((resolve, reject) => {
		ctx.pendingBridge.set(requestId, { resolve, reject });
		child.stdin.write(`${envelope}\n`, (error) => {
			if (!error) {
				return;
			}
			ctx.pendingBridge.delete(requestId);
			reject(error);
		});
	});
}

export function listPendingToolApprovalsForSession(
	sessionId: string,
	limit = 20,
): ToolApprovalRequestItem[] {
	const dir = toolApprovalDir();
	if (!existsSync(dir)) {
		return [];
	}
	const items: ToolApprovalRequestItem[] = [];
	const prefix = toolApprovalRequestPrefix(sessionId);
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (!entry.isFile()) {
			continue;
		}
		if (!entry.name.startsWith(prefix) || !entry.name.endsWith(".json")) {
			continue;
		}
		try {
			const parsed = JSON.parse(
				readFileSync(join(dir, entry.name), "utf8"),
			) as ToolApprovalRequestItem;
			items.push(parsed);
		} catch {
			// Ignore malformed approval files.
		}
	}
	items.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
	return items.slice(0, Math.max(1, limit));
}

export function broadcastApprovalSnapshots(ctx: HostContext) {
	const dir = toolApprovalDir();
	if (!existsSync(dir)) {
		return;
	}
	const sessionIds = new Set<string>();
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (!entry.isFile() || !entry.name.includes(".request.")) {
			continue;
		}
		const [sessionId] = entry.name.split(".request.");
		if (sessionId?.trim()) {
			sessionIds.add(sessionId.trim());
		}
	}
	for (const sessionId of sessionIds) {
		sendEvent(ctx, "tool_approval_state", {
			sessionId,
			items: listPendingToolApprovalsForSession(sessionId, 50),
		});
	}
}

export function ensureApprovalWatcher(ctx: HostContext) {
	if (ctx.approvalWatcher) {
		return;
	}
	mkdirSync(toolApprovalDir(), { recursive: true });
	ctx.approvalWatcher = watch(toolApprovalDir(), () => {
		if (ctx.approvalBroadcastTimer) {
			clearTimeout(ctx.approvalBroadcastTimer);
		}
		ctx.approvalBroadcastTimer = setTimeout(() => {
			broadcastApprovalSnapshots(ctx);
		}, 50);
	});
}

export async function respondToolApproval(
	ctx: HostContext,
	args?: Record<string, unknown>,
) {
	const sessionId = String(args?.sessionId ?? "").trim();
	const requestId = String(args?.requestId ?? "").trim();
	if (!sessionId || !requestId) {
		throw new Error("sessionId and requestId are required");
	}
	const path = toolApprovalDecisionPath(sessionId, requestId);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(
		path,
		JSON.stringify({
			approved: Boolean(args?.approved),
			reason: typeof args?.reason === "string" ? args.reason : undefined,
			ts: nowMs(),
		}),
	);
	const requestPath = join(
		toolApprovalDir(),
		`${sessionId}.request.${requestId}.json`,
	);
	if (existsSync(requestPath)) {
		unlinkSync(requestPath);
	}
	sendEvent(ctx, "tool_approval_state", {
		sessionId,
		items: listPendingToolApprovalsForSession(sessionId, 50),
	});
	return true;
}

export async function handleChatSessionCommand(
	ctx: HostContext,
	request: ChatSessionCommandRequest,
): Promise<unknown> {
	if (request.action === "start") {
		if (!request.config) {
			throw new Error("missing config for start action");
		}
		setRuntimeHomeDir(request.config);
		addRuntimeLoggerContext(request.config);
		const response = (await runBridgeCommand(ctx, {
			action: "start",
			config: request.config,
		})) as { sessionId?: string };
		const sessionId = response.sessionId?.trim();
		if (!sessionId) {
			throw new Error("chat runtime bridge start response missing session id");
		}
		await runBridgeCommand(ctx, {
			action: "set_sessions",
			sessionIds: [sessionId],
		});
		ctx.liveSessions.set(sessionId, {
			config: request.config,
			messages: [],
			busy: false,
			startedAt: nowMs(),
			status: "idle",
		});
		return { sessionId };
	}

	if (request.action === "send") {
		const prompt = request.prompt?.trim() || "";
		const hasAttachments =
			(request.attachments?.userImages?.length ?? 0) > 0 ||
			(request.attachments?.userFiles?.length ?? 0) > 0;
		if (!prompt && !hasAttachments) {
			throw new Error("prompt is required for send action");
		}
		const sessionId = request.sessionId?.trim();
		if (!sessionId) {
			throw new Error("sessionId is required for send action");
		}

		let session = ctx.liveSessions.get(sessionId);
		if (!session) {
			if (!request.config) {
				throw new Error("session not found. start a new session.");
			}
			const messages = readPersistedChatMessages(sessionId);
			if (!messages) {
				throw new Error("session not found. start a new session.");
			}
			session = {
				config: request.config,
				messages,
				busy: false,
				startedAt: nowMs(),
				status: "idle",
				prompt: derivePromptFromMessages(messages),
				title: readSessionMetadataTitle(sessionId),
			};
			ctx.liveSessions.set(sessionId, session);
		}
		if (request.config) {
			session.config = request.config;
		}
		if (session.busy) {
			throw new Error("session is busy. wait for current response to finish.");
		}
		session.busy = true;
		session.status = "running";
		session.endedAt = undefined;
		if (prompt) {
			session.prompt = prompt;
		}
		setRuntimeHomeDir(session.config);
		addRuntimeLoggerContext(session.config);
		await runBridgeCommand(ctx, {
			action: "set_sessions",
			sessionIds: [sessionId],
		});
		const resultEnvelope = (await runBridgeCommand(ctx, {
			action: "send",
			sessionId,
			request: {
				config: session.config,
				messages: session.messages,
				prompt,
				attachments: request.attachments,
			},
		})) as { result?: ChatTurnResult };
		const result = resultEnvelope.result;
		if (!result) {
			throw new Error("chat runtime bridge send response missing result");
		}

		const persistedMessages = persistUsageInMessages(
			(Array.isArray(result.messages) ? result.messages : []) as unknown[],
			session.config,
			result,
		);
		session.messages = persistedMessages;
		session.busy = false;
		session.status = normalizeChatFinishStatus(result.finishReason);
		session.endedAt = nowMs();
		persistSessionMessages(sessionId, persistedMessages);
		sendEvent(ctx, "tool_approval_state", {
			sessionId,
			items: listPendingToolApprovalsForSession(sessionId, 50),
		});
		return {
			sessionId,
			result,
		};
	}

	if (request.action === "abort") {
		const sessionId = request.sessionId?.trim();
		if (sessionId) {
			await runBridgeCommand(ctx, { action: "abort", sessionId });
			const session = ctx.liveSessions.get(sessionId);
			if (session) {
				session.busy = false;
				session.status = "cancelled";
				session.endedAt = nowMs();
			}
		}
		return {
			sessionId: request.sessionId,
			ok: true,
		};
	}

	if (request.action === "reset") {
		const sessionId = request.sessionId?.trim();
		if (sessionId) {
			ctx.liveSessions.delete(sessionId);
			await runBridgeCommand(ctx, { action: "reset", sessionId });
		}
		return {
			sessionId: request.sessionId,
			ok: true,
		};
	}

	throw new Error("unsupported action");
}
