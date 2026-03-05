"use client";

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
	AlertCircle,
	CheckCircle2,
	ChevronDown,
	Clock,
	Filter,
	Loader2,
	Pin,
	Plus,
	Search,
	Settings,
	XCircle,
} from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import type {
	SessionHistoryItem,
	SessionHistoryStatus,
} from "@/lib/session-history";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { normalizeTitle } from "./utils";

type CliDiscoveredSession = Omit<SessionHistoryItem, "status"> & {
	status: string;
};

interface Thread {
	id: string;
	title: string;
	codebase: string;
	time: string;
	provider: string;
	model: string;
	inputTokens?: number;
	outputTokens?: number;
	totalCostUsd?: number;
	status: SessionHistoryStatus;
	pinned?: boolean;
}

type SessionHookEvent = {
	inputTokens?: number;
	outputTokens?: number;
	totalCost?: number;
};

type SessionMessage = {
	role?: string;
	content?: string;
};

const filterOptions = ["All", "Running", "Recent", "Pinned"] as const;
type FilterOption = (typeof filterOptions)[number];

function parseTimestamp(value?: string): number {
	if (!value) return Number.NEGATIVE_INFINITY;
	const trimmed = value.trim();
	const maybeEpoch = Number(trimmed);
	if (Number.isFinite(maybeEpoch)) {
		// Treat 10-digit epochs as seconds; 13-digit as milliseconds.
		if (/^\d{10}$/.test(trimmed)) {
			return maybeEpoch * 1000;
		}
		return maybeEpoch;
	}
	const parsed = new Date(trimmed).getTime();
	return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function compareSessionsByStartedAtDesc(
	a: SessionHistoryItem,
	b: SessionHistoryItem,
): number {
	const timeDelta = parseTimestamp(b.startedAt) - parseTimestamp(a.startedAt);
	if (timeDelta !== 0) {
		return timeDelta;
	}
	return b.sessionId.localeCompare(a.sessionId);
}

function normalizeDiscoveredStatus(
	status: string,
	prompt?: string,
): SessionHistoryStatus {
	const normalized = status.toLowerCase();
	const hasPrompt = Boolean(prompt?.trim());
	if (normalized.includes("complete") || normalized.includes("done"))
		return "completed";
	if (
		normalized.includes("cancel") ||
		normalized.includes("abort") ||
		normalized.includes("interrupt")
	)
		return "cancelled";
	if (normalized.includes("fail") || normalized.includes("error"))
		return "failed";
	if (normalized.includes("run") || normalized.includes("start"))
		return hasPrompt ? "running" : "idle";
	if (normalized === "idle") return "idle";
	return "idle";
}

function formatRelativeTime(value?: string): string {
	if (!value) return "just now";
	const timestamp = parseTimestamp(value);
	const date = Number.isFinite(timestamp)
		? new Date(timestamp)
		: new Date(value);
	if (Number.isNaN(date.getTime())) return "";

	const diffMs = Date.now() - date.getTime();
	const minute = 60 * 1000;
	const hour = 60 * minute;
	const day = 24 * hour;

	if (diffMs < minute) return "now";
	if (diffMs < hour) return `${Math.max(1, Math.floor(diffMs / minute))}m`;
	if (diffMs < day) return `${Math.max(1, Math.floor(diffMs / hour))}h`;
	return `${Math.max(1, Math.floor(diffMs / day))}d`;
}

function basenamePath(input?: string): string {
	if (!input) return "workspace";
	const trimmed = input.replace(/[\\/]+$/, "");
	if (!trimmed) return "workspace";
	const parts = trimmed.split(/[\\/]/);
	return parts[parts.length - 1] || "workspace";
}

function toTitle(session: SessionHistoryItem): string {
	const line = session.prompt?.trim().split("\n")[0]?.trim();
	if (line) return line.slice(0, 70);
	return `Session ${session.sessionId.slice(-6)}`;
}

function titleFromMessages(messages: SessionMessage[]): string | null {
	for (const role of ["user", "assistant"] as const) {
		for (const message of messages) {
			if (message.role !== role) {
				continue;
			}
			const content =
				typeof message.content === "string" ? message.content : "";
			const line = normalizeTitle(content).trim().split("\n")[0]?.trim();
			if (line) {
				return line.slice(0, 70);
			}
		}
	}
	return null;
}

function inferStatusFromMessages(
	status: SessionHistoryStatus,
	messages: SessionMessage[],
): SessionHistoryStatus {
	const meaningfulMessages = messages.filter((message) => {
		if (message.role !== "user" && message.role !== "assistant") {
			return false;
		}
		const content = typeof message.content === "string" ? message.content : "";
		return content.trim().length > 0;
	});
	if (meaningfulMessages.length === 0) {
		return status === "running" ? "running" : "idle";
	}
	const lastMeaningful = meaningfulMessages[meaningfulMessages.length - 1];
	if (status === "failed" && lastMeaningful.role === "assistant") {
		return "completed";
	}
	return status;
}

function toThread(session: SessionHistoryItem): Thread {
	return {
		id: session.sessionId,
		title: toTitle(session),
		codebase: basenamePath(session.workspaceRoot || session.cwd),
		time: formatRelativeTime(session.endedAt || session.startedAt),
		provider: session.provider || "",
		model: session.model || "",
		status: normalizeDiscoveredStatus(session.status, session.prompt),
	};
}

function formatTokenCount(
	inputTokens?: number,
	outputTokens?: number,
): string | null {
	const inCount = inputTokens ?? 0;
	const outCount = outputTokens ?? 0;
	const total = inCount + outCount;
	if (total <= 0) {
		return null;
	}
	if (total >= 1000) {
		return `${(total / 1000).toFixed(total >= 10000 ? 0 : 1)}k tok`;
	}
	return `${total} tok`;
}

function formatCostUsd(value?: number): string | null {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return null;
	}
	if (value < 0.01) {
		return `$${value.toFixed(4)}`;
	}
	if (value < 1) {
		return `$${value.toFixed(3)}`;
	}
	return `$${value.toFixed(2)}`;
}

export function AgentSidebar({
	onNewThread,
	onOpenSession,
	setView,
	activeSessionId,
}: {
	onNewThread?: () => void;
	onOpenSession?: (session: SessionHistoryItem) => void;
	setView: (view: "chat" | "settings") => void;
	activeSessionId?: string | null;
}) {
	const [sessions, setSessions] = useState<SessionHistoryItem[]>([]);
	const [threads, setThreads] = useState<Thread[]>([]);
	const [activeThread, setActiveThread] = useState("");
	const [filter, setFilter] = useState<FilterOption>("All");
	const [searchOpen, setSearchOpen] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");
	const [showMoreCount, setShowMoreCount] = useState(10);
	const [isLoadingHistory, setIsLoadingHistory] = useState(false);
	const usageLoadingRef = useRef<Set<string>>(new Set());
	const usageHydratedStatusRef = useRef<Map<string, SessionHistoryStatus>>(
		new Map(),
	);
	const titleLoadingRef = useRef<Set<string>>(new Set());
	const messageHydratedStatusRef = useRef<Map<string, SessionHistoryStatus>>(
		new Map(),
	);

	const refreshSessions = useCallback(async () => {
		setIsLoadingHistory(true);
		try {
			const [cliDiscovered, chatDiscovered] = await Promise.all([
				invoke<CliDiscoveredSession[]>("list_cli_sessions", {
					limit: 300,
				}).catch(() => []),
				invoke<CliDiscoveredSession[]>("list_chat_sessions", {
					limit: 300,
				}).catch(() => []),
			]);
			const discovered = [...chatDiscovered, ...cliDiscovered];
			const topLevelById = new Map<string, SessionHistoryItem>();
			for (const session of discovered) {
				const normalized: SessionHistoryItem = {
					...session,
					status: normalizeDiscoveredStatus(session.status, session.prompt),
				};
				const existing = topLevelById.get(normalized.sessionId);
				if (!existing) {
					topLevelById.set(normalized.sessionId, normalized);
					continue;
				}
				// Keep the canonical top-level session with the newer start time.
				if (compareSessionsByStartedAtDesc(normalized, existing) < 0) {
					topLevelById.set(normalized.sessionId, normalized);
				}
			}
			const topLevelSessions = Array.from(topLevelById.values())
				.filter((session) => !session.isSubagent && !session.parentSessionId)
				.sort(compareSessionsByStartedAtDesc);

			setSessions(topLevelSessions);
			const mapped = topLevelSessions.map(toThread);
			setThreads((current) => {
				const existingById = new Map(
					current.map((thread) => [thread.id, thread]),
				);
				const usageById = new Map(
					current.map((thread) => [
						thread.id,
						{
							inputTokens: thread.inputTokens,
							outputTokens: thread.outputTokens,
							totalCostUsd: thread.totalCostUsd,
						},
					]),
				);
				return mapped.map((thread) => {
					const existing = existingById.get(thread.id);
					const keepExistingTitle =
						Boolean(existing) &&
						thread.title.startsWith("Session ") &&
						!(existing?.title.startsWith("Session ") ?? true);
					return {
						...thread,
						title:
							keepExistingTitle && existing ? existing.title : thread.title,
						...usageById.get(thread.id),
					};
				});
			});
			setActiveThread((current) => {
				if (current && mapped.some((thread) => thread.id === current)) {
					return current;
				}
				return mapped[0]?.id ?? "";
			});
		} catch {
			// Ignore in browser mode or when tauri command is unavailable.
		} finally {
			setIsLoadingHistory(false);
		}
	}, []);

	useEffect(() => {
		let disposed = false;
		let unlistenEnded: UnlistenFn | undefined;

		const runRefresh = () => {
			if (!disposed) {
				void refreshSessions();
			}
		};

		runRefresh();
		const interval = window.setInterval(() => {
			void invoke("poll_sessions").catch(() => {
				// Ignore when tauri command is unavailable.
			});
			runRefresh();
		}, 3500);

		void listen<{ sessionId: string }>("agent://session-ended", () => {
			runRefresh();
		}).then((unlisten) => {
			if (disposed) {
				unlisten();
			} else {
				unlistenEnded = unlisten;
			}
		});

		return () => {
			disposed = true;
			window.clearInterval(interval);
			if (unlistenEnded) {
				unlistenEnded();
			}
		};
	}, [refreshSessions]);

	useEffect(() => {
		setActiveThread(activeSessionId ?? "");
	}, [activeSessionId]);

	useEffect(() => {
		const recent = sessions.slice(0, 24);
		for (const session of recent) {
			const sessionId = session.sessionId;
			if (!sessionId) {
				continue;
			}
			if (usageLoadingRef.current.has(sessionId)) {
				continue;
			}
			const existing = threads.find((item) => item.id === sessionId);
			const hasUsage =
				existing?.inputTokens !== undefined ||
				existing?.outputTokens !== undefined;
			const lastHydratedStatus = usageHydratedStatusRef.current.get(sessionId);
			const shouldFetch =
				!hasUsage ||
				session.status === "running" ||
				lastHydratedStatus !== session.status;
			if (!shouldFetch) {
				continue;
			}
			usageLoadingRef.current.add(sessionId);
			void invoke<SessionHookEvent[]>("read_session_hooks", {
				sessionId,
				limit: 1200,
			})
				.then((events) => {
					const inputTokens = events.reduce(
						(sum, event) => sum + (event.inputTokens ?? 0),
						0,
					);
					const outputTokens = events.reduce(
						(sum, event) => sum + (event.outputTokens ?? 0),
						0,
					);
					const totalCostUsd = events.reduce(
						(sum, event) => sum + (event.totalCost ?? 0),
						0,
					);
					setThreads((current) =>
						current.map((thread) =>
							thread.id === sessionId
								? { ...thread, inputTokens, outputTokens, totalCostUsd }
								: thread,
						),
					);
				})
				.catch(() => {
					// Ignore sessions without hook logs.
					if (!hasUsage) {
						setThreads((current) =>
							current.map((thread) =>
								thread.id === sessionId
									? { ...thread, inputTokens: 0, outputTokens: 0 }
									: thread,
							),
						);
					}
				})
				.finally(() => {
					usageHydratedStatusRef.current.set(sessionId, session.status);
					usageLoadingRef.current.delete(sessionId);
				});
		}
	}, [sessions, threads]);

	useEffect(() => {
		const recent = sessions.slice(0, 24);
		for (const session of recent) {
			const sessionId = session.sessionId;
			if (!sessionId) {
				continue;
			}
			if (titleLoadingRef.current.has(sessionId)) {
				continue;
			}
			const existing = threads.find((item) => item.id === sessionId);
			if (!existing) {
				continue;
			}
			const lastHydratedStatus =
				messageHydratedStatusRef.current.get(sessionId);
			const shouldHydrateTitle = existing.title.startsWith("Session ");
			const shouldHydrateStatus =
				existing.status === "failed" ||
				existing.status === "completed" ||
				existing.status === "idle" ||
				lastHydratedStatus !== session.status;
			if (!shouldHydrateTitle && !shouldHydrateStatus) {
				continue;
			}
			titleLoadingRef.current.add(sessionId);
			void invoke<SessionMessage[]>("read_session_messages", {
				sessionId,
				maxMessages: 80,
			})
				.then((messages) => {
					const nextTitle = titleFromMessages(messages);
					setThreads((current) =>
						current.map((thread) => {
							if (thread.id !== sessionId) {
								return thread;
							}
							const nextStatus = inferStatusFromMessages(
								thread.status,
								messages,
							);
							const title = nextTitle ?? thread.title;
							if (title === thread.title && nextStatus === thread.status) {
								return thread;
							}
							return { ...thread, title, status: nextStatus };
						}),
					);
					setSessions((current) =>
						current.map((item) => {
							if (item.sessionId !== sessionId) {
								return item;
							}
							const nextStatus = inferStatusFromMessages(item.status, messages);
							if (nextStatus === item.status) {
								return item;
							}
							return { ...item, status: nextStatus };
						}),
					);
				})
				.catch(() => {
					// Ignore sessions that cannot be hydrated.
				})
				.finally(() => {
					messageHydratedStatusRef.current.set(sessionId, session.status);
					titleLoadingRef.current.delete(sessionId);
				});
		}
	}, [sessions, threads]);

	const filteredThreads = useMemo(() => {
		let filtered = threads;
		if (searchQuery) {
			const q = searchQuery.toLowerCase();
			filtered = filtered.filter(
				(t) =>
					t.title.toLowerCase().includes(q) ||
					t.codebase.toLowerCase().includes(q),
			);
		}
		switch (filter) {
			case "Running":
				return filtered.filter((t) => t.status === "running");
			case "Recent":
				return filtered.slice(0, 8);
			case "Pinned":
				return filtered.filter((t) => t.pinned);
			default:
				return filtered;
		}
	}, [filter, searchQuery, threads]);

	const pinnedThreads = useMemo(
		() => filteredThreads.filter((t) => t.pinned),
		[filteredThreads],
	);
	const runningThreads = useMemo(
		() => filteredThreads.filter((t) => t.status === "running" && !t.pinned),
		[filteredThreads],
	);
	const recentThreads = useMemo(
		() => filteredThreads.filter((t) => t.status !== "running" && !t.pinned),
		[filteredThreads],
	);
	const displayedThreads =
		filter === "All" ? null : filteredThreads.slice(0, showMoreCount);
	const filterMenu = (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					aria-label="Filter sessions"
					className="flex items-center gap-1 rounded-md p-1 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
					size="icon-sm"
					variant="ghost"
				>
					<Filter className="h-2 w-2" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-36">
				<DropdownMenuRadioGroup
					onValueChange={(value) => {
						setFilter(value as FilterOption);
						setShowMoreCount(10);
					}}
					value={filter}
				>
					{filterOptions.map((opt) => (
						<DropdownMenuRadioItem key={opt} value={opt}>
							{opt}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);

	return (
		<div className="flex h-full min-h-0 min-w-0 shrink-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground">
			<div className="flex flex-col gap-1 p-3 w-full">
				<Button
					className="justify-start"
					onClick={() => onNewThread?.()}
					variant="sidebar"
				>
					<Plus className="h-4 w-4" />
					New Session
				</Button>
			</div>

			<div className="px-3 pb-2 w-full">
				{searchOpen ? (
					<div className="flex items-center gap-2 rounded-md bg-sidebar-accent px-2 py-1.5">
						<Search className="h-3.5 w-3.5 text-muted-foreground" />
						<input
							className="flex-1 bg-transparent text-sm text-sidebar-foreground outline-none placeholder:text-muted-foreground"
							onBlur={() => {
								if (!searchQuery) setSearchOpen(false);
							}}
							onChange={(e) => setSearchQuery(e.target.value)}
							placeholder="Search sessions..."
							value={searchQuery}
						/>
					</div>
				) : (
					<Button
						className="px-2 py-1.5"
						onClick={() => setSearchOpen(true)}
						type="button"
						variant="sidebarItem"
					>
						<Search className="h-3.5 w-3.5" />
						<span>Search</span>
					</Button>
				)}
			</div>

			<div className="min-h-0 flex-1 w-full">
				<ScrollArea className="h-full min-h-0 w-full">
					<div className="flex min-w-0 flex-col gap-0.5 overflow-x-hidden px-2 pb-3">
						{isLoadingHistory && threads.length === 0 ? (
							<div className="px-3 py-4 text-xs text-muted-foreground">
								Loading session history...
							</div>
						) : filter === "All" ? (
							<>
								{pinnedThreads.length > 0 && (
									<ThreadSection label="Pinned">
										{pinnedThreads.map((thread) => (
											<ThreadItem
												isActive={activeThread === thread.id}
												key={thread.id}
												onClick={() => {
													setActiveThread(thread.id);
													const session = sessions.find(
														(item) => item.sessionId === thread.id,
													);
													if (session) {
														onOpenSession?.(session);
													}
												}}
												thread={thread}
											/>
										))}
									</ThreadSection>
								)}

								{runningThreads.length > 0 && (
									<ThreadSection label="Running">
										{runningThreads.map((thread) => (
											<ThreadItem
												isActive={activeThread === thread.id}
												key={thread.id}
												onClick={() => {
													setActiveThread(thread.id);
													const session = sessions.find(
														(item) => item.sessionId === thread.id,
													);
													if (session) {
														onOpenSession?.(session);
													}
												}}
												thread={thread}
											/>
										))}
									</ThreadSection>
								)}

								{recentThreads.length > 0 && (
									<ThreadSection action={filterMenu} label="Sessions">
										{recentThreads.slice(0, showMoreCount).map((thread) => (
											<ThreadItem
												isActive={activeThread === thread.id}
												key={thread.id}
												onClick={() => {
													setActiveThread(thread.id);
													const session = sessions.find(
														(item) => item.sessionId === thread.id,
													);
													if (session) {
														onOpenSession?.(session);
													}
												}}
												thread={thread}
											/>
										))}
										{recentThreads.length > showMoreCount && (
											<Button
												onClick={() => setShowMoreCount((c) => c + 10)}
												type="button"
												variant="sidebarText"
											>
												<ChevronDown className="h-3 w-3" />
												Show more
											</Button>
										)}
									</ThreadSection>
								)}

								{filteredThreads.length === 0 && (
									<div className="px-3 py-4 text-xs text-muted-foreground">
										{searchQuery
											? "No sessions match your search."
											: "No sessions found in history."}
									</div>
								)}
							</>
						) : (
							<ThreadSection action={filterMenu} label={filter}>
								{displayedThreads?.map((thread) => (
									<ThreadItem
										isActive={activeThread === thread.id}
										key={thread.id}
										onClick={() => {
											setActiveThread(thread.id);
											const session = sessions.find(
												(item) => item.sessionId === thread.id,
											);
											if (session) {
												onOpenSession?.(session);
											}
										}}
										thread={thread}
									/>
								))}
								{filteredThreads.length > showMoreCount && (
									<Button
										onClick={() => setShowMoreCount((c) => c + 10)}
										type="button"
										variant="sidebarText"
									>
										<ChevronDown className="h-3 w-3" />
										Show more
									</Button>
								)}
							</ThreadSection>
						)}
					</div>
				</ScrollArea>
			</div>

			<div className="shrink-0 border-t border-sidebar-border bg-sidebar p-3">
				<Button
					type="button"
					variant="sidebarItem"
					onClick={() => setView("settings")}
				>
					<Settings className="h-4 w-4" />
					Settings
				</Button>
			</div>
		</div>
	);
}

function ThreadSection({
	label,
	action,
	children,
}: {
	label: string;
	action?: ReactNode;
	children: ReactNode;
}) {
	return (
		<div className="mb-1 w-full min-w-0 max-w-full overflow-x-hidden">
			<div className="flex w-full min-w-0 max-w-full items-center justify-between px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
				<span>{label}</span>
				{action}
			</div>
			{children}
		</div>
	);
}

function ThreadItem({
	thread,
	isActive,
	onClick,
}: {
	thread: Thread;
	isActive: boolean;
	onClick: () => void;
}) {
	const tokenLabel = formatTokenCount(thread.inputTokens, thread.outputTokens);
	const costLabel = formatCostUsd(thread.totalCostUsd);

	return (
		<Button
			className={cn(
				"font-normal",
				isActive
					? "bg-sidebar-accent text-sidebar-accent-foreground"
					: "text-sidebar-foreground/80 hover:bg-sidebar-accent/50",
			)}
			onClick={onClick}
			type="button"
			variant="session"
		>
			<div className="mt-0.5 shrink-0">
				{thread.status === "running" ? (
					<Loader2 className="size-3 animate-spin text-primary" />
				) : thread.status === "completed" ? (
					<CheckCircle2 className="size-3 text-primary" />
				) : thread.status === "failed" ? (
					<XCircle className="size-3 text-destructive" />
				) : thread.status === "cancelled" ? (
					<AlertCircle className="size-3 text-warning" />
				) : (
					<Clock className="size-3 text-muted-foreground" />
				)}
			</div>
			<div className="min-w-0 flex-1">
				<div className="flex w-full min-w-0 max-w-full items-center gap-1.5 overflow-hidden">
					<span className="block min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-xs leading-tight">
						{normalizeTitle(thread.title)}
					</span>
					{thread.pinned && (
						<Pin className="h-3 w-3 shrink-0 text-muted-foreground" />
					)}
				</div>
				<div className="mt-0.5 flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
					<span className="truncate rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px]">
						{thread.codebase}
					</span>
					<span className="ml-auto">{thread.time}</span>
				</div>
				<div className="hidden mt-0.5 flex min-w-0 items-center gap-1.5 overflow-hidden text-[10px] text-muted-foreground">
					<span className="truncate">{thread.model}</span>
					{tokenLabel && (
						<>
							<span>·</span>
							<span className="shrink-0">{tokenLabel}</span>
						</>
					)}
					{costLabel && (
						<>
							<span>·</span>
							<span className="shrink-0">{costLabel}</span>
						</>
					)}
				</div>
			</div>
		</Button>
	);
}
