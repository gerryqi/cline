"use client";

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseLineToEvent } from "@/lib/parse";
import { createTeamName } from "@/lib/team-name";
import type {
	ParsedLogEvent,
	StartSessionRequest,
	StreamChunkEvent,
	TeamHistoryItem,
	TeamStateEnvelope,
} from "@/lib/types";

export function useAgentSession() {
	const [sessionId, setSessionId] = useState<string | null>(null);
	const [isRunning, setIsRunning] = useState(false);
	const [rawTranscript, setRawTranscript] = useState("");
	const [events, setEvents] = useState<ParsedLogEvent[]>([]);
	const [teamState, setTeamState] = useState<TeamStateEnvelope | null>(null);
	const [teamHistory, setTeamHistory] = useState<TeamHistoryItem[]>([]);
	const [existingTeams, setExistingTeams] = useState<string[]>([]);
	const [error, setError] = useState<string | null>(null);
	const lineBuffer = useRef("");
	const handledApprovalRequests = useRef<Set<string>>(new Set());
	const approvalPromptActive = useRef(false);

	interface SessionEndedEvent {
		sessionId: string;
		reason: string;
		ts: number;
	}

	const clearState = useCallback(() => {
		setSessionId(null);
		setIsRunning(false);
		setRawTranscript("");
		setEvents([]);
		setTeamState(null);
		setTeamHistory([]);
		setError(null);
		lineBuffer.current = "";
	}, []);

	useEffect(() => {
		let unlisten: UnlistenFn | undefined;

		listen<StreamChunkEvent>(
			"agent://chunk",
			(event: { payload: StreamChunkEvent }) => {
				const payload = event.payload;
				if (!payload || payload.sessionId !== sessionId) {
					return;
				}

				const next = payload.chunk;
				setRawTranscript((prev) => prev + next);

				lineBuffer.current += next;
				const lines = lineBuffer.current.split("\n");
				lineBuffer.current = lines.pop() ?? "";

				const parsed = lines
					.map(parseLineToEvent)
					.filter((item): item is ParsedLogEvent => !!item);
				if (parsed.length > 0) {
					setEvents((prev) => [...prev, ...parsed].slice(-500));
				}
			},
		).then((u: UnlistenFn) => {
			unlisten = u;
		});

		return () => {
			if (unlisten) {
				unlisten();
			}
		};
	}, [sessionId]);

	useEffect(() => {
		let unlistenEnded: UnlistenFn | undefined;

		listen<SessionEndedEvent>(
			"agent://session-ended",
			(event: { payload: SessionEndedEvent }) => {
				const payload = event.payload;
				if (!payload || payload.sessionId !== sessionId) {
					return;
				}
				setIsRunning(false);
				setSessionId(null);
				setError(payload.reason);
			},
		).then((u: UnlistenFn) => {
			unlistenEnded = u;
		});

		return () => {
			if (unlistenEnded) {
				unlistenEnded();
			}
		};
	}, [sessionId]);

	useEffect(() => {
		if (!sessionId || !isRunning) {
			return;
		}
		let cancelled = false;
		const timer = setInterval(() => {
			void invoke<string>("read_session_transcript", {
				sessionId,
				maxChars: 200000,
			})
				.then((text) => {
					if (cancelled) {
						return;
					}
					setRawTranscript((prev) => (text.length > prev.length ? text : prev));
				})
				.catch(() => {
					// Ignore polling errors; live event stream is still primary path.
				});
		}, 1000);

		return () => {
			cancelled = true;
			clearInterval(timer);
		};
	}, [sessionId, isRunning]);

	useEffect(() => {
		if (!sessionId || !isRunning) {
			return;
		}
		let cancelled = false;
		const timer = setInterval(() => {
			if (cancelled || approvalPromptActive.current) {
				return;
			}
			void invoke<
				Array<{
					requestId: string;
					sessionId: string;
					toolCallId: string;
					toolName: string;
					input?: unknown;
				}>
			>("poll_tool_approvals", { sessionId, limit: 10 })
				.then((items) => {
					if (cancelled || items.length === 0) {
						return;
					}
					const next = items.find(
						(item) => !handledApprovalRequests.current.has(item.requestId),
					);
					if (!next) {
						return;
					}
					handledApprovalRequests.current.add(next.requestId);
					approvalPromptActive.current = true;
					const preview = (() => {
						try {
							return JSON.stringify(next.input ?? {}, null, 2).slice(0, 400);
						} catch {
							return String(next.input ?? "");
						}
					})();
					const approved = window.confirm(
						`Approve tool "${next.toolName}"?\n\n${preview}`,
					);
					void invoke("respond_tool_approval", {
						sessionId,
						requestId: next.requestId,
						approved,
						reason: approved
							? "Approved in desktop UI"
							: "Denied in desktop UI",
					}).finally(() => {
						approvalPromptActive.current = false;
					});
				})
				.catch(() => {
					// Ignore transient approval polling failures.
				});
		}, 500);

		return () => {
			cancelled = true;
			clearInterval(timer);
		};
	}, [sessionId, isRunning]);

	const start = useCallback(
		async (request: StartSessionRequest) => {
			clearState();
			const normalizedRequest: StartSessionRequest = {
				...request,
				autoApproveTools: request.autoApproveTools !== false,
				teamName: request.enableTeams
					? request.teamName?.trim() || createTeamName()
					: request.teamName,
			};

			try {
				const id = await invoke<string>("start_session", {
					request: normalizedRequest,
				});
				handledApprovalRequests.current.clear();
				approvalPromptActive.current = false;
				setSessionId(id);
				setIsRunning(true);
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err));
			}
		},
		[clearState],
	);

	const abort = useCallback(async () => {
		if (!sessionId) {
			return;
		}
		try {
			await invoke("abort_session", { sessionId });
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}, [sessionId]);

	const stop = useCallback(async () => {
		if (!sessionId) {
			return;
		}
		try {
			await invoke("stop_session", { sessionId });
		} finally {
			setIsRunning(false);
			setSessionId(null);
		}
	}, [sessionId]);

	const reset = useCallback(async () => {
		const activeSession = sessionId;
		if (activeSession) {
			try {
				await invoke("stop_session", { sessionId: activeSession });
			} catch {
				// Ignore stop errors during reset and still clear local UI state.
			}
		}
		clearState();
	}, [clearState, sessionId]);

	const sendPrompt = useCallback(
		async (prompt: string) => {
			if (!sessionId || !prompt.trim()) {
				return;
			}
			setError(null);
			try {
				await invoke("send_prompt", { sessionId, prompt });
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				setError(message);
				if (
					message.includes("no longer running") ||
					message.includes("session not found")
				) {
					setIsRunning(false);
					setSessionId(null);
				}
			}
		},
		[sessionId],
	);

	const refreshTeam = useCallback(async (teamName: string) => {
		const normalizedTeamName = teamName.trim();
		if (!normalizedTeamName) {
			setTeamState(null);
			setTeamHistory([]);
			return;
		}
		try {
			const [state, history] = await Promise.all([
				invoke<TeamStateEnvelope | null>("read_team_state", {
					teamName: normalizedTeamName,
				}),
				invoke<TeamHistoryItem[]>("read_team_history", {
					teamName: normalizedTeamName,
					limit: 200,
				}),
			]);
			setTeamState(state);
			setTeamHistory(history);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}, []);

	const refreshTeams = useCallback(async () => {
		try {
			const teams = await invoke<string[]>("list_existing_teams");
			setExistingTeams(teams);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}, []);

	const summary = useMemo(() => {
		return {
			toolCalls: events.filter((e) => e.type === "tool").length,
			missionLogs: events.filter((e) => e.type === "mission").length,
			mailboxEvents: events.filter((e) => e.type === "mailbox").length,
			teamEvents: events.filter(
				(e) => e.type === "team" || e.type === "team_task",
			).length,
		};
	}, [events]);

	return {
		sessionId,
		isRunning,
		rawTranscript,
		events,
		teamState,
		teamHistory,
		existingTeams,
		error,
		summary,
		start,
		abort,
		stop,
		reset,
		sendPrompt,
		refreshTeam,
		refreshTeams,
	};
}
