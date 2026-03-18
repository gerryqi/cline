"use client";

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { serializeAttachments } from "@/hooks/chat-session/attachments";
import {
	CHAT_TRANSPORT_UNAVAILABLE_MESSAGE,
	CHAT_WS_ENDPOINT_RETRY_ATTEMPTS,
	CHAT_WS_ENDPOINT_RETRY_DELAY_MS,
	CHAT_WS_RECONNECT_BASE_DELAY_MS,
	CHAT_WS_RECONNECT_MAX_DELAY_MS,
	CHAT_WS_REQUEST_TIMEOUT_MS,
	getInitialChatConfig,
} from "@/hooks/chat-session/constants";
import {
	buildToolPayloadString,
	extractAssistantTextFromRpcMessages,
	inferHydratedChatStatus,
	makeId,
	normalizeRuntimeConfig,
	resolveCredentialError,
} from "@/hooks/chat-session/helpers";
import type {
	AgentChunkEvent,
	ChatApiResult,
	ChatSessionHookEvent,
	ChatTransportState,
	ChatWsChunkEvent,
	ChatWsResponseEvent,
	CoreLogChunk,
	ProcessContext,
	ToolApprovalRequestItem,
	ToolCallEndEvent,
	ToolCallStartEvent,
} from "@/hooks/chat-session/types";
import {
	type ChatMessage,
	type ChatSessionConfig,
	ChatSessionConfigSchema,
	type ChatSessionStatus,
} from "@/lib/chat-schema";
import {
	buildSessionDiffState,
	EMPTY_DIFF_SUMMARY,
	type SessionDiffSummary,
	type SessionFileDiff,
} from "@/lib/session-diff";
import type { SessionHistoryItem } from "@/lib/session-history";

export { DEFAULT_CHAT_CONFIG } from "@/hooks/chat-session/constants";

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
				timeoutId: ReturnType<typeof setTimeout>;
			}
		>
	>(new Map());
	const messagesRef = useRef<ChatMessage[]>([]);

	useEffect(() => {
		activeSessionIdRef.current = sessionId;
	}, [sessionId]);

	useEffect(() => {
		activeAssistantMessageIdRef.current = activeAssistantMessageId;
	}, [activeAssistantMessageId]);

	useEffect(() => {
		messagesRef.current = messages;
	}, [messages]);

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
					events.filter(
						(event) =>
							event.hookEventName === "tool_call" ||
							event.hookName === "tool_call",
					).length,
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
				const existing = message.content;
				if (existing.endsWith(chunk)) {
					return message;
				}
				if (chunk.startsWith(existing)) {
					return {
						...message,
						content: chunk,
					};
				}
				return {
					...message,
					content: `${existing}${chunk}`,
				};
			}),
		);
	}, []);

	const applyProcessContext = useCallback(async () => {
		try {
			const ctx = await invoke<ProcessContext>("get_process_context");
			setConfig((prev) => ({
				...prev,
				workspaceRoot: ctx.workspaceRoot || ctx.cwd,
				cwd: ctx.workspaceRoot || ctx.cwd,
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
					const sessionMessages = messagesRef.current.filter(
						(message) => message.sessionId === listeningSessionId,
					);
					const latestSessionMessage = sessionMessages.at(-1);
					if (latestSessionMessage?.role === "assistant") {
						listeningAssistantId = latestSessionMessage.id;
						activeAssistantMessageIdRef.current = listeningAssistantId;
						setActiveAssistantMessageId(listeningAssistantId);
					} else {
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
		const postViaInvoke = async () => {
			return await invoke<{
				sessionId?: string;
				result?: ChatApiResult;
				ok?: boolean;
			}>("chat_session_command", {
				request: body,
			});
		};
		if (!wsReadyPromiseRef.current) {
			return await postViaInvoke();
		}
		try {
			await Promise.race([
				wsReadyPromiseRef.current,
				new Promise<void>((_resolve, reject) =>
					setTimeout(
						() => reject(new Error(CHAT_TRANSPORT_UNAVAILABLE_MESSAGE)),
						5000,
					),
				),
			]);
		} catch {
			return await postViaInvoke();
		}
		const socket = wsRef.current;
		if (!socket || socket.readyState !== WebSocket.OPEN) {
			return await postViaInvoke();
		}
		const requestId = makeId("chat_req");
		const response = await new Promise<{
			sessionId?: string;
			result?: ChatApiResult;
			ok?: boolean;
		}>((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				const pending = wsRequestResolversRef.current.get(requestId);
				if (!pending) {
					return;
				}
				wsRequestResolversRef.current.delete(requestId);
				pending.reject(
					new Error("Chat request timed out waiting for websocket response"),
				);
			}, CHAT_WS_REQUEST_TIMEOUT_MS);
			wsRequestResolversRef.current.set(requestId, {
				resolve,
				reject,
				timeoutId,
			});
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
				clearTimeout(pending.timeoutId);
				pending.reject(new Error(errorMessage));
			}
			wsRequestResolversRef.current.clear();
		};
		const setTransportUnavailableErrorIfActive = () => {
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
					clearTimeout(resolver.timeoutId);
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
			const credentialError = resolveCredentialError(parsed.data);
			if (credentialError) {
				setError(credentialError);
				setStatus("error");
				addMessage({
					id: makeId("error"),
					sessionId: null,
					role: "error",
					content: credentialError,
					createdAt: Date.now(),
				});
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
			const credentialError = resolveCredentialError(parsed.data);
			if (credentialError) {
				setError(credentialError);
				setStatus("error");
				addMessage({
					id: makeId("error"),
					sessionId: activeSessionId,
					role: "error",
					content: credentialError,
					createdAt: Date.now(),
				});
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
				const totalCost =
					typeof result?.usage?.totalCost === "number"
						? result.usage.totalCost
						: undefined;
				const assistantMessageId = activeAssistantMessageIdRef.current;
				if (
					assistantMessageId &&
					(typeof inputTokens === "number" ||
						typeof outputTokens === "number" ||
						typeof totalCost === "number")
				) {
					setMessages((prev) =>
						prev.map((message) => {
							if (message.id !== assistantMessageId) {
								return message;
							}
							return {
								...message,
								meta: {
									...(message.meta ?? {}),
									inputTokens:
										typeof inputTokens === "number"
											? inputTokens
											: message.meta?.inputTokens,
									outputTokens:
										typeof outputTokens === "number"
											? outputTokens
											: message.meta?.outputTokens,
									totalCost:
										typeof totalCost === "number"
											? totalCost
											: message.meta?.totalCost,
									providerId: config.provider,
									modelId: config.model,
								},
							};
						}),
					);
				}

				if (result?.finishReason === "error") {
					if (!resolvedAssistantText) {
						const toolError = Array.isArray(result?.toolCalls)
							? result.toolCalls.find((call) => call.error)?.error
							: undefined;
						addMessage({
							id: makeId("error"),
							sessionId: activeSessionId,
							role: "error",
							content:
								toolError?.trim() ||
								"Runtime turn failed before an assistant response was produced.",
							createdAt: Date.now(),
						});
					}
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
				cwd: session.workspaceRoot || session.cwd || prev.cwd,
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
