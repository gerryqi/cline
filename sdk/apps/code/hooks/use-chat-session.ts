"use client";

import { models } from "@cline/llms";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	type ChatMessage,
	type ChatSessionConfig,
	ChatSessionConfigSchema,
	type ChatSessionStatus,
} from "@/lib/chat-schema";
import { readModelSelectionStorageFromWindow } from "@/lib/model-selection";
import {
	buildSessionDiffState,
	EMPTY_DIFF_SUMMARY,
	type SessionDiffSummary,
	type SessionFileDiff,
	type SessionHookEvent,
} from "@/lib/session-diff";
import type {
	SessionHistoryItem,
	SessionHistoryStatus,
} from "@/lib/session-history";

type ProcessContext = {
	workspaceRoot: string;
	cwd: string;
};

type AgentChunkEvent = {
	sessionId: string;
	stream: string;
	chunk: string;
	ts: number;
};

type ChatWsResponseEvent = {
	type: "chat_response";
	requestId: string;
	response?: {
		sessionId?: string;
		result?: ChatApiResult;
		ok?: boolean;
	};
	error?: string;
};

type ChatWsChunkEvent = {
	type: "chat_event";
	event: AgentChunkEvent;
};

type CoreLogChunk = {
	level?: string;
	message?: string;
	metadata?: unknown;
};

type ToolCallStartEvent = {
	toolCallId?: string;
	toolName?: string;
	input?: unknown;
};

type ToolCallEndEvent = {
	toolCallId?: string;
	toolName?: string;
	input?: unknown;
	output?: unknown;
	error?: string;
	durationMs?: number;
};

type ToolApprovalRequestItem = {
	requestId: string;
	sessionId: string;
	createdAt: string;
	toolCallId: string;
	toolName: string;
	input?: unknown;
	iteration?: number;
	agentId?: string;
	conversationId?: string;
};

type ChatApiResult = {
	text: string;
	inputTokens?: number;
	outputTokens?: number;
	usage?: {
		inputTokens?: number;
		outputTokens?: number;
	};
	iterations?: number;
	finishReason?: "completed" | "max_iterations" | "aborted" | "error";
	toolCalls?: Array<{
		name: string;
		input?: unknown;
		output?: unknown;
		error?: string;
		durationMs?: number;
	}>;
	messages?: unknown[];
};

type RpcMessageLike = {
	role?: string;
	content?: unknown;
};

type SerializedAttachmentFile = {
	name: string;
	content: string;
};

type SerializedAttachments = {
	userImages: string[];
	userFiles: SerializedAttachmentFile[];
};
type ChatTransportState = "connecting" | "reconnecting" | "connected";

const DEFAULT_SYSTEM_PROMPT =
	"You are Cline, an AI coding agent. Follow user requests and use tools when needed.";
const CHAT_TRANSPORT_UNAVAILABLE_MESSAGE =
	"Chat connection is unavailable. Reopen the app window to restore realtime chat.";
const CHAT_WS_ENDPOINT_RETRY_ATTEMPTS = 60;
const CHAT_WS_ENDPOINT_RETRY_DELAY_MS = 100;
const CHAT_WS_RECONNECT_BASE_DELAY_MS = 300;
const CHAT_WS_RECONNECT_MAX_DELAY_MS = 3000;

export const DEFAULT_CHAT_CONFIG: ChatSessionConfig = {
	workspaceRoot: "",
	cwd: "",
	provider: "anthropic",
	model: models.ANTHROPIC_DEFAULT_MODEL,
	mode: "act",
	apiKey: process.env.ANTHROPIC_API_KEY || "",
	systemPrompt: DEFAULT_SYSTEM_PROMPT,
	maxIterations: 10,
	enableTools: true,
	enableSpawn: true,
	enableTeams: true,
	autoApproveTools: true,
	teamName: "app-team",
	missionStepInterval: 3,
	missionTimeIntervalMs: 120000,
};

function getInitialChatConfig(): ChatSessionConfig {
	const selection = readModelSelectionStorageFromWindow();
	const rememberedProvider = selection.lastProvider.trim();
	const rememberedModelForProvider = rememberedProvider
		? selection.lastModelByProvider[rememberedProvider]
		: undefined;
	const rememberedModelForDefaultProvider =
		selection.lastModelByProvider[DEFAULT_CHAT_CONFIG.provider];
	const provider = rememberedProvider || DEFAULT_CHAT_CONFIG.provider;
	const model =
		rememberedModelForProvider ||
		(provider === DEFAULT_CHAT_CONFIG.provider
			? rememberedModelForDefaultProvider
			: undefined) ||
		DEFAULT_CHAT_CONFIG.model;

	return {
		...DEFAULT_CHAT_CONFIG,
		provider,
		model,
	};
}

function makeId(prefix: string): string {
	return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function stringifyRpcMessageContent(content: unknown): string {
	if (typeof content === "string") {
		return content;
	}
	if (Array.isArray(content)) {
		const parts: string[] = [];
		for (const block of content) {
			if (typeof block === "string") {
				if (block.trim()) {
					parts.push(block);
				}
				continue;
			}
			if (!block || typeof block !== "object") {
				continue;
			}
			const obj = block as Record<string, unknown>;
			const text = obj.text;
			if (typeof text === "string" && text.trim()) {
				parts.push(text);
			}
		}
		return parts.join("\n");
	}
	if (content && typeof content === "object") {
		const obj = content as Record<string, unknown>;
		const text = obj.text;
		if (typeof text === "string") {
			return text;
		}
	}
	return "";
}

function extractAssistantTextFromRpcMessages(messages: unknown): string {
	if (!Array.isArray(messages)) {
		return "";
	}
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const message = messages[i] as RpcMessageLike;
		if (message?.role !== "assistant") {
			continue;
		}
		const text = stringifyRpcMessageContent(message.content).trim();
		if (text) {
			return text;
		}
	}
	return "";
}

function buildToolPayloadString(options: {
	toolName: string;
	input: unknown;
	output: unknown;
	error?: string;
}): string {
	const { toolName, input, output, error } = options;
	return JSON.stringify({
		toolName,
		input,
		result: error ? error : output,
		isError: Boolean(error),
	});
}

function normalizeRuntimeConfig(config: ChatSessionConfig): ChatSessionConfig {
	return {
		...config,
		enableSpawn: false,
		enableTeams: false,
	};
}

function mapHistoryStatusToChatStatus(
	status: SessionHistoryStatus,
): ChatSessionStatus {
	switch (status) {
		case "running":
			return "running";
		case "completed":
			return "completed";
		case "failed":
			return "failed";
		case "cancelled":
			return "cancelled";
		default:
			return "idle";
	}
}

type ChatSessionHookEvent = SessionHookEvent & {
	inputTokens?: number;
	outputTokens?: number;
};

function inferHydratedChatStatus(
	fallback: SessionHistoryStatus,
	messages: ChatMessage[],
): ChatSessionStatus {
	if (fallback === "failed") {
		return "failed";
	}
	if (fallback === "cancelled") {
		return "cancelled";
	}
	const meaningfulMessages = messages.filter((message) => {
		if (message.role !== "user" && message.role !== "assistant") {
			return false;
		}
		return message.content.trim().length > 0;
	});
	if (meaningfulMessages.length === 0) {
		return mapHistoryStatusToChatStatus(fallback);
	}
	if (fallback === "running") {
		const lastMeaningful = meaningfulMessages[meaningfulMessages.length - 1];
		if (lastMeaningful?.role === "assistant") {
			return "completed";
		}
	}
	return mapHistoryStatusToChatStatus(fallback);
}

async function readFileAsDataUrl(file: File): Promise<string> {
	return await new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => {
			const value = typeof reader.result === "string" ? reader.result : "";
			resolve(value);
		};
		reader.onerror = () => {
			reject(reader.error ?? new Error("failed reading file"));
		};
		reader.readAsDataURL(file);
	});
}

async function serializeAttachments(
	files: File[],
): Promise<SerializedAttachments> {
	const userImages: string[] = [];
	const userFiles: SerializedAttachmentFile[] = [];

	for (const file of files) {
		if (file.type.startsWith("image/")) {
			const dataUrl = await readFileAsDataUrl(file);
			if (dataUrl) {
				userImages.push(dataUrl);
			}
			continue;
		}

		const content = await file.text();
		userFiles.push({
			name: file.name,
			content,
		});
	}

	return { userImages, userFiles };
}

export function useChatSession() {
	const [sessionId, setSessionId] = useState<string | null>(null);
	const [status, setStatus] = useState<ChatSessionStatus>("idle");
	const [isHydratingSession, setIsHydratingSession] = useState(false);
	const [config, setConfig] = useState<ChatSessionConfig>(getInitialChatConfig);
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [rawTranscript, setRawTranscript] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [toolCalls, setToolCalls] = useState(0);
	const [tokensIn, setTokensIn] = useState(0);
	const [tokensOut, setTokensOut] = useState(0);
	const [fileDiffs, setFileDiffs] = useState<SessionFileDiff[]>([]);
	const [diffSummary, setDiffSummary] =
		useState<SessionDiffSummary>(EMPTY_DIFF_SUMMARY);
	const [activeAssistantMessageId, setActiveAssistantMessageId] = useState<
		string | null
	>(null);
	const [_hydratedHistorySessionId, setHydratedHistorySessionId] = useState<
		string | null
	>(null);
	const [pendingToolApprovals, setPendingToolApprovals] = useState<
		ToolApprovalRequestItem[]
	>([]);
	const liveToolMessageIdsRef = useRef<Record<string, string>>({});
	const liveToolInputsRef = useRef<Record<string, unknown>>({});
	const activeSessionIdRef = useRef<string | null>(null);
	const activeAssistantMessageIdRef = useRef<string | null>(null);
	const hydrationRequestIdRef = useRef(0);
	const wsRef = useRef<WebSocket | null>(null);
	const wsReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);
	const hasWsConnectedOnceRef = useRef(false);
	const wsReadyResolveRef = useRef<(() => void) | null>(null);
	const wsReadyPromiseRef = useRef<Promise<void> | null>(null);
	const wsConnectErrorRef = useRef<Error | null>(null);
	const [chatTransportState, setChatTransportState] =
		useState<ChatTransportState>("connecting");
	const wsRequestResolversRef = useRef<
		Map<
			string,
			{
				resolve: (value: {
					sessionId?: string;
					result?: ChatApiResult;
					ok?: boolean;
				}) => void;
				reject: (error: Error) => void;
			}
		>
	>(new Map());

	useEffect(() => {
		activeSessionIdRef.current = sessionId;
	}, [sessionId]);

	useEffect(() => {
		activeAssistantMessageIdRef.current = activeAssistantMessageId;
	}, [activeAssistantMessageId]);

	const refreshSessionDiffSummary = useCallback(
		async (targetSessionId: string) => {
			try {
				const events = await invoke<ChatSessionHookEvent[]>(
					"read_session_hooks",
					{
						sessionId: targetSessionId,
						limit: 800,
					},
				);
				const diffState = buildSessionDiffState(events);
				setFileDiffs(diffState.fileDiffs);
				setDiffSummary(diffState.summary);
				setToolCalls(
					events.filter((event) => event.hookEventName === "tool_call").length,
				);
				setTokensIn(
					events.reduce((sum, event) => sum + (event.inputTokens ?? 0), 0),
				);
				setTokensOut(
					events.reduce((sum, event) => sum + (event.outputTokens ?? 0), 0),
				);
			} catch {
				// Ignore in non-Tauri mode.
			}
		},
		[],
	);

	const addMessage = useCallback((message: ChatMessage) => {
		setMessages((prev) => [...prev, message].slice(-800));
	}, []);

	const materializeToolMessagesFromResult = useCallback(
		(options: {
			sessionId: string;
			turnStartedAt: number;
			toolCalls: NonNullable<ChatApiResult["toolCalls"]>;
		}) => {
			const { sessionId: targetSessionId, turnStartedAt, toolCalls } = options;
			if (toolCalls.length === 0) {
				return;
			}
			setMessages((prev) => {
				const hasLiveToolMessagesForTurn = prev.some(
					(message) =>
						message.sessionId === targetSessionId &&
						message.role === "tool" &&
						message.createdAt >= turnStartedAt,
				);
				if (hasLiveToolMessagesForTurn) {
					return prev;
				}

				const next = [...prev];
				for (const call of toolCalls) {
					next.push({
						id: makeId("tool"),
						sessionId: targetSessionId,
						role: "tool",
						content: JSON.stringify({
							toolName: call.name,
							input: call.input,
							result: call.error ? call.error : call.output,
							isError: Boolean(call.error),
						}),
						createdAt: turnStartedAt + next.length,
						meta: {
							toolName: call.name,
							hookEventName: "tool_call_end",
						},
					});
				}
				return next.slice(-800);
			});
		},
		[],
	);

	const replaceMessageContent = useCallback((id: string, content: string) => {
		setMessages((prev) =>
			prev.map((message) => {
				if (message.id !== id) {
					return message;
				}
				return {
					...message,
					content,
				};
			}),
		);
	}, []);

	const appendMessageContent = useCallback((id: string, chunk: string) => {
		if (!chunk) {
			return;
		}
		setMessages((prev) =>
			prev.map((message) => {
				if (message.id !== id) {
					return message;
				}
				return {
					...message,
					content: `${message.content}${chunk}`,
				};
			}),
		);
	}, []);

	const applyProcessContext = useCallback(async () => {
		try {
			const ctx = await invoke<ProcessContext>("get_process_context");
			setConfig((prev) => ({
				...prev,
				workspaceRoot: ctx.workspaceRoot,
				cwd: ctx.cwd || ctx.workspaceRoot,
			}));
		} catch {
			// Ignore in non-Tauri mode.
		}
	}, []);

	useEffect(() => {
		void applyProcessContext();
	}, [applyProcessContext]);

	useEffect(() => {
		if (!sessionId) {
			setFileDiffs([]);
			setDiffSummary(EMPTY_DIFF_SUMMARY);
			setPendingToolApprovals([]);
			return;
		}
		void refreshSessionDiffSummary(sessionId);
	}, [refreshSessionDiffSummary, sessionId]);

	useEffect(() => {
		let disposed = false;
		let timer: ReturnType<typeof setInterval> | null = null;
		const activeSessionId = sessionId;
		if (!activeSessionId) {
			setPendingToolApprovals([]);
			return;
		}

		const poll = async () => {
			try {
				const pending = await invoke<ToolApprovalRequestItem[]>(
					"poll_tool_approvals",
					{
						sessionId: activeSessionId,
						limit: 20,
					},
				);
				if (disposed) {
					return;
				}
				setPendingToolApprovals(pending);
			} catch {
				// Ignore in non-Tauri mode.
			}
		};

		void poll();
		timer = setInterval(() => {
			void poll();
		}, 500);

		return () => {
			disposed = true;
			if (timer) {
				clearInterval(timer);
			}
		};
	}, [sessionId]);

	const handleIncomingChunk = useCallback(
		(payload: AgentChunkEvent) => {
			if (
				payload.stream !== "chat_text" &&
				payload.stream !== "chat_tool_call_start" &&
				payload.stream !== "chat_tool_call_end" &&
				payload.stream !== "chat_core_log"
			) {
				return;
			}
			const listeningSessionId = activeSessionIdRef.current;
			if (!listeningSessionId || payload.sessionId !== listeningSessionId) {
				return;
			}
			let listeningAssistantId = activeAssistantMessageIdRef.current;
			if (payload.stream === "chat_text") {
				if (!listeningAssistantId) {
					const assistantId = makeId("assistant");
					listeningAssistantId = assistantId;
					activeAssistantMessageIdRef.current = assistantId;
					setActiveAssistantMessageId(assistantId);
					addMessage({
						id: assistantId,
						sessionId: listeningSessionId,
						role: "assistant",
						content: "",
						createdAt: payload.ts || Date.now(),
					});
				}
				appendMessageContent(listeningAssistantId, payload.chunk);
				setRawTranscript((prev) => `${prev}${payload.chunk}`);
				return;
			}
			if (payload.stream === "chat_core_log") {
				let parsed: CoreLogChunk | undefined;
				try {
					parsed = JSON.parse(payload.chunk) as CoreLogChunk;
				} catch {
					console.info("[core]", payload.chunk);
					return;
				}
				const level = parsed.level?.trim().toLowerCase() || "info";
				const message = parsed.message?.trim() || payload.chunk;
				const metadata = parsed.metadata;
				if (level === "error") {
					console.error("[core]", message, metadata);
					return;
				}
				if (level === "warn") {
					console.warn("[core]", message, metadata);
					return;
				}
				if (level === "debug") {
					console.debug("[core]", message, metadata);
					return;
				}
				console.info("[core]", message, metadata);
				return;
			}
			if (payload.stream === "chat_tool_call_start") {
				let parsed: ToolCallStartEvent = {};
				try {
					parsed = JSON.parse(payload.chunk) as ToolCallStartEvent;
				} catch {
					return;
				}
				const toolName = parsed.toolName ?? "unknown_tool";
				const toolCallId = parsed.toolCallId ?? makeId("tool_call");
				const messageId = makeId("tool");
				liveToolMessageIdsRef.current[toolCallId] = messageId;
				liveToolInputsRef.current[toolCallId] = parsed.input;
				addMessage({
					id: messageId,
					sessionId: listeningSessionId,
					role: "tool",
					content: buildToolPayloadString({
						toolName,
						input: parsed.input,
						output: null,
					}),
					createdAt: Date.now(),
					meta: {
						toolName,
						hookEventName: "tool_call_start",
					},
				});
				setToolCalls((prev) => prev + 1);
				return;
			}
			let parsed: ToolCallEndEvent = {};
			try {
				parsed = JSON.parse(payload.chunk) as ToolCallEndEvent;
			} catch {
				return;
			}
			const toolName = parsed.toolName ?? "unknown_tool";
			const toolCallId = parsed.toolCallId;
			const messageId = toolCallId
				? liveToolMessageIdsRef.current[toolCallId]
				: undefined;
			const toolInput =
				parsed.input ??
				(toolCallId ? liveToolInputsRef.current[toolCallId] : undefined);
			const toolPayload = buildToolPayloadString({
				toolName,
				input: toolInput,
				output: parsed.output,
				error: parsed.error,
			});
			if (toolCallId) {
				delete liveToolMessageIdsRef.current[toolCallId];
				delete liveToolInputsRef.current[toolCallId];
			}
			if (messageId) {
				replaceMessageContent(messageId, toolPayload);
				setMessages((prev) =>
					prev.map((message) => {
						if (message.id !== messageId) {
							return message;
						}
						return {
							...message,
							meta: {
								...message.meta,
								toolName,
								hookEventName: "tool_call_end",
							},
						};
					}),
				);
				return;
			}
			addMessage({
				id: makeId("tool"),
				sessionId: listeningSessionId,
				role: "tool",
				content: toolPayload,
				createdAt: Date.now(),
				meta: {
					toolName,
					hookEventName: "tool_call_end",
				},
			});
		},
		[addMessage, appendMessageContent, replaceMessageContent],
	);

	const postSession = useCallback(async (body: Record<string, unknown>) => {
		if (!wsReadyPromiseRef.current) {
			throw new Error(CHAT_TRANSPORT_UNAVAILABLE_MESSAGE);
		}
		await Promise.race([
			wsReadyPromiseRef.current,
			new Promise<void>((_resolve, reject) =>
				setTimeout(
					() => reject(new Error(CHAT_TRANSPORT_UNAVAILABLE_MESSAGE)),
					5000,
				),
			),
		]);
		const socket = wsRef.current;
		if (!socket || socket.readyState !== WebSocket.OPEN) {
			throw (
				wsConnectErrorRef.current ??
				new Error(CHAT_TRANSPORT_UNAVAILABLE_MESSAGE)
			);
		}
		const requestId = makeId("chat_req");
		const response = await new Promise<{
			sessionId?: string;
			result?: ChatApiResult;
			ok?: boolean;
		}>((resolve, reject) => {
			wsRequestResolversRef.current.set(requestId, { resolve, reject });
			socket.send(
				JSON.stringify({
					requestId,
					request: body,
				}),
			);
		});
		return response;
	}, []);

	useEffect(() => {
		let disposed = false;
		let reconnectAttempt = 0;
		const clearReconnectTimer = () => {
			if (wsReconnectTimerRef.current) {
				clearTimeout(wsReconnectTimerRef.current);
				wsReconnectTimerRef.current = null;
			}
		};
		const resetWsReadyPromise = () => {
			wsReadyPromiseRef.current = new Promise<void>((resolve) => {
				wsReadyResolveRef.current = resolve;
			});
		};
		const rejectPendingRequests = (errorMessage: string) => {
			for (const pending of wsRequestResolversRef.current.values()) {
				pending.reject(new Error(errorMessage));
			}
			wsRequestResolversRef.current.clear();
		};
		const setTransportUnavailableErrorIfActive = () => {
			wsConnectErrorRef.current = new Error(CHAT_TRANSPORT_UNAVAILABLE_MESSAGE);
			if (
				!activeSessionIdRef.current &&
				wsRequestResolversRef.current.size === 0
			) {
				return;
			}
			setError(CHAT_TRANSPORT_UNAVAILABLE_MESSAGE);
			setStatus((prev) => (prev === "running" ? prev : "error"));
		};
		const scheduleReconnect = () => {
			if (disposed) {
				return;
			}
			clearReconnectTimer();
			const delayMs = Math.min(
				CHAT_WS_RECONNECT_BASE_DELAY_MS * 2 ** reconnectAttempt,
				CHAT_WS_RECONNECT_MAX_DELAY_MS,
			);
			reconnectAttempt += 1;
			wsReconnectTimerRef.current = setTimeout(() => {
				void connect();
			}, delayMs);
		};
		wsConnectErrorRef.current = null;
		resetWsReadyPromise();
		const connect = async () => {
			let endpoint = "";
			const currentSocket = wsRef.current;
			if (
				currentSocket &&
				(currentSocket.readyState === WebSocket.OPEN ||
					currentSocket.readyState === WebSocket.CONNECTING)
			) {
				return;
			}
			setChatTransportState(
				hasWsConnectedOnceRef.current ? "reconnecting" : "connecting",
			);
			resetWsReadyPromise();
			for (
				let attempt = 0;
				attempt < CHAT_WS_ENDPOINT_RETRY_ATTEMPTS;
				attempt += 1
			) {
				try {
					endpoint = await invoke<string>("get_chat_ws_endpoint");
					if (endpoint.trim()) {
						break;
					}
				} catch {
					// wait for bridge startup
				}
				await new Promise((resolve) =>
					setTimeout(resolve, CHAT_WS_ENDPOINT_RETRY_DELAY_MS),
				);
			}
			if (!endpoint.trim() || disposed) {
				if (disposed) {
					return;
				}
				setTransportUnavailableErrorIfActive();
				scheduleReconnect();
				return;
			}
			const socket = new WebSocket(endpoint);
			wsRef.current = socket;
			socket.onopen = () => {
				if (disposed || wsRef.current !== socket) {
					return;
				}
				reconnectAttempt = 0;
				hasWsConnectedOnceRef.current = true;
				wsConnectErrorRef.current = null;
				setChatTransportState("connected");
				wsReadyResolveRef.current?.();
				wsReadyResolveRef.current = null;
				setError((prev) =>
					prev === CHAT_TRANSPORT_UNAVAILABLE_MESSAGE ? null : prev,
				);
			};
			socket.onmessage = (message) => {
				if (disposed || wsRef.current !== socket) {
					return;
				}
				let parsed: ChatWsResponseEvent | ChatWsChunkEvent;
				try {
					parsed = JSON.parse(message.data as string) as
						| ChatWsResponseEvent
						| ChatWsChunkEvent;
				} catch {
					return;
				}
				if (parsed.type === "chat_event") {
					handleIncomingChunk(parsed.event);
					return;
				}
				if (parsed.type === "chat_response") {
					const resolver = wsRequestResolversRef.current.get(parsed.requestId);
					if (!resolver) {
						return;
					}
					wsRequestResolversRef.current.delete(parsed.requestId);
					if (parsed.error) {
						resolver.reject(new Error(parsed.error));
						return;
					}
					resolver.resolve(parsed.response ?? {});
				}
			};
			socket.onerror = () => {
				if (disposed || wsRef.current !== socket) {
					return;
				}
				wsConnectErrorRef.current = new Error(
					CHAT_TRANSPORT_UNAVAILABLE_MESSAGE,
				);
			};
			socket.onclose = () => {
				if (wsRef.current === socket) {
					wsRef.current = null;
				}
				if (disposed) {
					return;
				}
				setTransportUnavailableErrorIfActive();
				rejectPendingRequests(CHAT_TRANSPORT_UNAVAILABLE_MESSAGE);
				resetWsReadyPromise();
				scheduleReconnect();
			};
		};
		void connect();
		return () => {
			disposed = true;
			clearReconnectTimer();
			rejectPendingRequests("chat websocket closed");
			wsRef.current?.close();
			wsRef.current = null;
			wsReadyPromiseRef.current = null;
			wsReadyResolveRef.current = null;
			setChatTransportState("connecting");
		};
	}, [handleIncomingChunk]);

	const start = useCallback(
		async (nextConfig: ChatSessionConfig) => {
			const runtimeConfig = normalizeRuntimeConfig(nextConfig);
			const parsed = ChatSessionConfigSchema.safeParse(runtimeConfig);
			if (!parsed.success) {
				const message = parsed.error.issues
					.map((issue) => issue.message)
					.join(", ");
				setError(message);
				setStatus("error");
				return;
			}

			setError(null);
			setStatus("starting");
			setIsHydratingSession(false);
			setMessages([]);
			setRawTranscript("");
			setToolCalls(0);
			setTokensIn(0);
			setTokensOut(0);
			setFileDiffs([]);
			setDiffSummary(EMPTY_DIFF_SUMMARY);
			setConfig(parsed.data);
			setHydratedHistorySessionId(null);

			try {
				const payload = await postSession({
					action: "start",
					config: parsed.data,
				});
				const id = payload.sessionId;
				if (!id) {
					throw new Error("Missing session id from server");
				}
				setSessionId(id);
				setStatus("running");
				addMessage({
					id: makeId("status"),
					sessionId: id,
					role: "status",
					content: `Session started: ${id}`,
					createdAt: Date.now(),
				});
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				setError(message);
				setStatus("error");
				addMessage({
					id: makeId("error"),
					sessionId: null,
					role: "error",
					content: message,
					createdAt: Date.now(),
				});
			}
		},
		[addMessage, postSession],
	);

	const sendPrompt = useCallback(
		async (prompt: string, attachedFiles: File[] = []) => {
			const trimmed = prompt.trim();
			if (!trimmed && attachedFiles.length === 0) {
				return;
			}

			setError(null);
			setIsHydratingSession(false);
			let activeSessionId = sessionId;
			const runtimeConfig = normalizeRuntimeConfig(config);
			const parsed = ChatSessionConfigSchema.safeParse(runtimeConfig);
			if (!parsed.success) {
				const message = parsed.error.issues
					.map((issue) => issue.message)
					.join(", ");
				setError(message);
				setStatus("error");
				return;
			}

			if (!activeSessionId) {
				try {
					const payload = await postSession({
						action: "start",
						config: parsed.data,
					});
					const id = payload.sessionId;
					if (!id) {
						throw new Error("Missing session id from server");
					}
					activeSessionId = id;
					setSessionId(id);
					setStatus("running");
					setConfig(parsed.data);
					setHydratedHistorySessionId(null);
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					setError(message);
					setStatus("error");
					addMessage({
						id: makeId("error"),
						sessionId: null,
						role: "error",
						content: message,
						createdAt: Date.now(),
					});
					return;
				}
			}

			const now = Date.now();
			const serializedAttachments = await serializeAttachments(attachedFiles);
			const hasAttachments =
				serializedAttachments.userImages.length > 0 ||
				serializedAttachments.userFiles.length > 0;

			const userLabel = hasAttachments
				? `${trimmed}${trimmed.length > 0 ? "\n\n" : ""}[attached ${attachedFiles.length} file${attachedFiles.length === 1 ? "" : "s"}]`
				: trimmed;

			addMessage({
				id: makeId("user"),
				sessionId: activeSessionId,
				role: "user",
				content: userLabel,
				createdAt: now,
			});

			activeSessionIdRef.current = activeSessionId;
			activeAssistantMessageIdRef.current = null;
			setActiveAssistantMessageId(null);
			liveToolMessageIdsRef.current = {};
			liveToolInputsRef.current = {};

			setStatus("starting");
			try {
				const payload = await postSession({
					action: "send",
					sessionId: activeSessionId,
					prompt: trimmed,
					config: parsed.data,
					attachments: hasAttachments ? serializedAttachments : undefined,
				});

				const result = payload.result as ChatApiResult | undefined;
				const assistantText = (result?.text ?? "").trim();
				const fallbackAssistantText = extractAssistantTextFromRpcMessages(
					result?.messages,
				);
				const resolvedAssistantText = assistantText || fallbackAssistantText;
				if (resolvedAssistantText) {
					const assistantMessageId =
						activeAssistantMessageIdRef.current ?? makeId("assistant");
					activeAssistantMessageIdRef.current = assistantMessageId;
					setActiveAssistantMessageId(assistantMessageId);
					setMessages((prev) => {
						let found = false;
						const next = prev.map((message) => {
							if (message.id !== assistantMessageId) {
								return message;
							}
							found = true;
							return {
								...message,
								content: resolvedAssistantText,
							};
						});
						if (found) {
							return next;
						}
						return [
							...next,
							{
								id: assistantMessageId,
								sessionId: activeSessionId,
								role: "assistant" as const,
								content: resolvedAssistantText,
								createdAt: now + 1,
							},
						].slice(-800);
					});
				} else {
					// Recovery path: if transport missed result text, load canonical messages.
					try {
						const historyMessages = await invoke<ChatMessage[]>(
							"read_session_messages",
							{
								sessionId: activeSessionId,
								maxMessages: 800,
							},
						);
						if (historyMessages.length > 0) {
							setMessages(historyMessages);
						}
					} catch {
						// Keep optimistic state if hydration read fails.
					}
				}
				if (Array.isArray(result?.toolCalls) && result.toolCalls.length > 0) {
					materializeToolMessagesFromResult({
						sessionId: activeSessionId,
						turnStartedAt: now,
						toolCalls: result.toolCalls,
					});
				}

				const inputTokens = result?.usage?.inputTokens ?? result?.inputTokens;
				if (typeof inputTokens === "number") {
					setTokensIn((prev) => prev + inputTokens);
				}
				const outputTokens =
					result?.usage?.outputTokens ?? result?.outputTokens;
				if (typeof outputTokens === "number") {
					setTokensOut((prev) => prev + outputTokens);
				}

				if (result?.finishReason === "error") {
					setStatus("failed");
				} else if (result?.finishReason === "aborted") {
					setStatus("cancelled");
				} else {
					setStatus("completed");
				}
				void refreshSessionDiffSummary(activeSessionId);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				setError(message);
				setStatus("error");
				addMessage({
					id: makeId("error"),
					sessionId: activeSessionId,
					role: "error",
					content: message,
					createdAt: Date.now(),
				});
			} finally {
				activeAssistantMessageIdRef.current = null;
				setActiveAssistantMessageId(null);
				liveToolMessageIdsRef.current = {};
				liveToolInputsRef.current = {};
			}
		},
		[
			addMessage,
			config,
			materializeToolMessagesFromResult,
			refreshSessionDiffSummary,
			sessionId,
			postSession,
		],
	);

	const respondToolApproval = useCallback(
		async (requestId: string, approved: boolean) => {
			const activeSessionId = activeSessionIdRef.current;
			if (!activeSessionId) {
				return;
			}
			await invoke("respond_tool_approval", {
				sessionId: activeSessionId,
				requestId,
				approved,
				reason: approved
					? undefined
					: "Tool call rejected from desktop approval prompt",
			});
			setPendingToolApprovals((prev) =>
				prev.filter((item) => item.requestId !== requestId),
			);
		},
		[],
	);

	const approveToolApproval = useCallback(
		async (requestId: string) => {
			await respondToolApproval(requestId, true);
		},
		[respondToolApproval],
	);

	const rejectToolApproval = useCallback(
		async (requestId: string) => {
			await respondToolApproval(requestId, false);
		},
		[respondToolApproval],
	);

	const abort = useCallback(async () => {
		if (!sessionId) {
			return;
		}
		try {
			await postSession({ action: "abort", sessionId });
		} catch {
			// Best-effort abort path.
		}
		setStatus("cancelled");
	}, [sessionId, postSession]);

	const stop = useCallback(async () => {
		await abort();
	}, [abort]);

	const reset = useCallback(async () => {
		const activeSessionId = sessionId;
		if (activeSessionId) {
			try {
				await postSession({ action: "reset", sessionId: activeSessionId });
			} catch {
				// Best-effort reset path.
			}
		}
		setSessionId(null);
		setStatus("idle");
		setIsHydratingSession(false);
		setMessages([]);
		setRawTranscript("");
		setError(null);
		setToolCalls(0);
		setTokensIn(0);
		setTokensOut(0);
		setFileDiffs([]);
		setDiffSummary(EMPTY_DIFF_SUMMARY);
		activeSessionIdRef.current = null;
		activeAssistantMessageIdRef.current = null;
		setActiveAssistantMessageId(null);
		setHydratedHistorySessionId(null);
		setPendingToolApprovals([]);
		liveToolMessageIdsRef.current = {};
		liveToolInputsRef.current = {};
	}, [sessionId, postSession]);

	const hydrateSession = useCallback(
		async (session: SessionHistoryItem) => {
			const requestId = hydrationRequestIdRef.current + 1;
			hydrationRequestIdRef.current = requestId;
			setError(null);
			setStatus("starting");
			setIsHydratingSession(true);
			setSessionId(session.sessionId);
			setConfig((prev) => ({
				...prev,
				provider: session.provider || prev.provider,
				model: session.model || prev.model,
				workspaceRoot: session.workspaceRoot || prev.workspaceRoot,
				cwd: session.cwd || prev.cwd,
			}));
			activeSessionIdRef.current = session.sessionId;
			activeAssistantMessageIdRef.current = null;
			setActiveAssistantMessageId(null);
			setHydratedHistorySessionId(session.sessionId);
			setPendingToolApprovals([]);
			liveToolMessageIdsRef.current = {};
			liveToolInputsRef.current = {};

			try {
				const historyMessages = await invoke<ChatMessage[]>(
					"read_session_messages",
					{
						sessionId: session.sessionId,
						maxMessages: 800,
					},
				);
				if (hydrationRequestIdRef.current !== requestId) {
					return;
				}

				if (historyMessages.length > 0) {
					setMessages(historyMessages);
					setRawTranscript(
						historyMessages.map((message) => message.content).join("\n\n"),
					);
					setToolCalls(0);
					setTokensIn(0);
					setTokensOut(0);
					setFileDiffs([]);
					setStatus(inferHydratedChatStatus(session.status, historyMessages));
					void refreshSessionDiffSummary(session.sessionId);
					return;
				}
				let synthesizedMessages: ChatMessage[] = [];
				if (session.prompt?.trim()) {
					synthesizedMessages.push({
						id: makeId("history_user"),
						sessionId: session.sessionId,
						role: "user",
						content: session.prompt.trim(),
						createdAt: Date.now(),
					});
				}
				try {
					const transcript = await invoke<string>("read_session_transcript", {
						sessionId: session.sessionId,
						maxChars: 20000,
					});
					const text = transcript.trim();
					if (text) {
						synthesizedMessages = [
							...synthesizedMessages,
							{
								id: makeId("history_assistant"),
								sessionId: session.sessionId,
								role: "assistant",
								content: text,
								createdAt: Date.now(),
							},
						];
					}
				} catch {
					// Ignore transcript fallback failures.
				}
				setMessages(synthesizedMessages);
				setRawTranscript(
					synthesizedMessages.map((message) => message.content).join("\n\n"),
				);
				setToolCalls(0);
				setTokensIn(0);
				setTokensOut(0);
				setFileDiffs([]);
				setStatus(inferHydratedChatStatus(session.status, synthesizedMessages));
				void refreshSessionDiffSummary(session.sessionId);
			} catch (err) {
				if (hydrationRequestIdRef.current !== requestId) {
					return;
				}
				const message = err instanceof Error ? err.message : String(err);
				setError(message);
				setStatus("error");
				setMessages([
					{
						id: makeId("error"),
						sessionId: session.sessionId,
						role: "error",
						content: message,
						createdAt: Date.now(),
					},
				]);
			} finally {
				if (hydrationRequestIdRef.current === requestId) {
					setIsHydratingSession(false);
				}
			}
		},
		[refreshSessionDiffSummary],
	);

	const summary = useMemo(
		() => ({
			toolCalls,
			tokensIn,
			tokensOut,
			additions: diffSummary.additions,
			deletions: diffSummary.deletions,
		}),
		[
			diffSummary.additions,
			diffSummary.deletions,
			tokensIn,
			tokensOut,
			toolCalls,
		],
	);

	return {
		sessionId,
		status,
		chatTransportState,
		isHydratingSession,
		activeAssistantMessageId,
		config,
		messages,
		rawTranscript,
		error,
		summary,
		fileDiffs,
		pendingToolApprovals,
		setConfig,
		start,
		hydrateSession,
		sendPrompt,
		approveToolApproval,
		rejectToolApproval,
		abort,
		stop,
		reset,
	};
}
