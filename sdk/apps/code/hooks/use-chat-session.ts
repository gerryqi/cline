"use client";

import { models } from "@cline/llms/catalog";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

type ToolCallStartEvent = {
	toolCallId?: string;
	toolName?: string;
	input?: unknown;
};

type ToolCallEndEvent = {
	toolCallId?: string;
	toolName?: string;
	output?: unknown;
	error?: string;
	durationMs?: number;
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
};

type SerializedAttachmentFile = {
	name: string;
	content: string;
};

type SerializedAttachments = {
	userImages: string[];
	userFiles: SerializedAttachmentFile[];
};

const DEFAULT_SYSTEM_PROMPT =
	"You are Cline, an AI coding agent. Follow user requests and use tools when needed.";

export const DEFAULT_CHAT_CONFIG: ChatSessionConfig = {
	workspaceRoot: "",
	cwd: "",
	provider: "anthropic",
	model: models.ANTHROPIC_DEFAULT_MODEL,
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

function makeId(prefix: string): string {
	return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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

async function postSession(body: Record<string, unknown>) {
	const payload = (await invoke("chat_session_command", {
		request: body,
	})) as {
		error?: string;
		sessionId?: string;
		result?: {
			text: string;
			usage?: {
				inputTokens?: number;
				outputTokens?: number;
			};
			inputTokens?: number;
			outputTokens?: number;
			iterations?: number;
			finishReason?: "completed" | "max_iterations" | "aborted" | "error";
			toolCalls?: Array<{
				name: string;
				input?: unknown;
				output?: unknown;
				error?: string;
				durationMs?: number;
			}>;
		};
	};
	if (payload.error) {
		throw new Error(payload.error);
	}
	return payload;
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
	const [config, setConfig] = useState<ChatSessionConfig>(DEFAULT_CHAT_CONFIG);
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
	const [hydratedHistorySessionId, setHydratedHistorySessionId] = useState<
		string | null
	>(null);
	const liveToolMessageIdsRef = useRef<Record<string, string>>({});
	const activeSessionIdRef = useRef<string | null>(null);
	const activeAssistantMessageIdRef = useRef<string | null>(null);

	useEffect(() => {
		activeSessionIdRef.current = sessionId;
	}, [sessionId]);

	useEffect(() => {
		activeAssistantMessageIdRef.current = activeAssistantMessageId;
	}, [activeAssistantMessageId]);

	const refreshSessionDiffSummary = useCallback(
		async (targetSessionId: string) => {
			try {
				const events = await invoke<SessionHookEvent[]>("read_session_hooks", {
					sessionId: targetSessionId,
					limit: 800,
				});
				const diffState = buildSessionDiffState(events);
				setFileDiffs(diffState.fileDiffs);
				setDiffSummary(diffState.summary);
			} catch {
				// Ignore in non-Tauri mode.
			}
		},
		[],
	);

	const addMessage = useCallback((message: ChatMessage) => {
		setMessages((prev) => [...prev, message].slice(-800));
	}, []);

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
			return;
		}
		void refreshSessionDiffSummary(sessionId);
	}, [refreshSessionDiffSummary, sessionId]);

	useEffect(() => {
		let disposed = false;
		let unlisten: UnlistenFn | undefined;

		void listen<AgentChunkEvent>("agent://chunk", (event) => {
			if (disposed) {
				return;
			}
			const payload = event.payload;
			if (!payload || payload.stream !== "chat_text") {
				return;
			}
			const listeningSessionId = activeSessionIdRef.current;
			if (!listeningSessionId || payload.sessionId !== listeningSessionId) {
				return;
			}
			const listeningAssistantId = activeAssistantMessageIdRef.current;
			if (!listeningAssistantId) {
				return;
			}
			if (payload.stream === "chat_text") {
				appendMessageContent(listeningAssistantId, payload.chunk);
				setRawTranscript((prev) => `${prev}${payload.chunk}`);
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
				addMessage({
					id: messageId,
					sessionId: listeningSessionId,
					role: "tool",
					content: `[tool:start] ${toolName}`,
					createdAt: Date.now(),
					meta: {
						toolName,
						hookEventName: "tool_call_start",
					},
				});
				setToolCalls((prev) => prev + 1);
				return;
			}

			if (payload.stream === "chat_tool_call_end") {
				let parsed: ToolCallEndEvent = {};
				try {
					parsed = JSON.parse(payload.chunk) as ToolCallEndEvent;
				} catch {
					return;
				}
				const toolName = parsed.toolName ?? "unknown_tool";
				const toolCallId = parsed.toolCallId;
				const durationText =
					typeof parsed.durationMs === "number"
						? ` (${parsed.durationMs}ms)`
						: "";
				const content = parsed.error
					? `[tool:end] ${toolName} failed${durationText}: ${parsed.error}`
					: `[tool:end] ${toolName} completed${durationText}`;
				const messageId = toolCallId
					? liveToolMessageIdsRef.current[toolCallId]
					: undefined;
				if (messageId) {
					replaceMessageContent(messageId, content);
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
				} else {
					addMessage({
						id: makeId("tool"),
						sessionId: listeningSessionId,
						role: "tool",
						content,
						createdAt: Date.now(),
						meta: {
							toolName,
							hookEventName: "tool_call_end",
						},
					});
				}
			}
		})
			.then((fn) => {
				if (disposed) {
					fn();
					return;
				}
				unlisten = fn;
			})
			.catch(() => {
				// Ignore in non-Tauri mode.
			});

		return () => {
			disposed = true;
			if (unlisten) {
				unlisten();
			}
		};
	}, [addMessage, appendMessageContent, replaceMessageContent]);

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
		[addMessage],
	);

	const sendPrompt = useCallback(
		async (prompt: string, attachedFiles: File[] = []) => {
			const trimmed = prompt.trim();
			if (!trimmed && attachedFiles.length === 0) {
				return;
			}

			setError(null);
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

			const assistantId = makeId("assistant");
			activeSessionIdRef.current = activeSessionId;
			activeAssistantMessageIdRef.current = assistantId;
			setActiveAssistantMessageId(assistantId);
			addMessage({
				id: assistantId,
				sessionId: activeSessionId,
				role: "assistant",
				content: "",
				createdAt: now + 1,
			});

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
				const assistantText = result?.text ?? "";
				replaceMessageContent(assistantId, assistantText);

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
				setMessages((prev) => prev.filter((entry) => entry.id !== assistantId));
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
			}
		},
		[
			addMessage,
			config,
			refreshSessionDiffSummary,
			replaceMessageContent,
			sessionId,
		],
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
	}, [sessionId]);

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
	}, [sessionId]);

	const hydrateSession = useCallback(async (session: SessionHistoryItem) => {
		setError(null);
		setStatus("starting");
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

		try {
			const historyMessages = await invoke<ChatMessage[]>(
				"read_session_messages",
				{
					sessionId: session.sessionId,
					maxMessages: 800,
				},
			);

			if (historyMessages.length > 0) {
				setMessages(historyMessages);
				setRawTranscript(
					historyMessages.map((message) => message.content).join("\n\n"),
				);
				setToolCalls(0);
				setTokensIn(0);
				setTokensOut(0);
				setFileDiffs([]);
				setStatus(mapHistoryStatusToChatStatus(session.status));
				return;
			}
			setMessages([]);
			setRawTranscript("");
			setToolCalls(0);
			setTokensIn(0);
			setTokensOut(0);
			setFileDiffs([]);
			setStatus(mapHistoryStatusToChatStatus(session.status));
		} catch (err) {
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
		}
	}, []);

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
		config,
		messages,
		rawTranscript,
		error,
		summary,
		fileDiffs,
		setConfig,
		start,
		hydrateSession,
		sendPrompt,
		abort,
		stop,
		reset,
	};
}
