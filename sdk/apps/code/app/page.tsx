"use client";

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { AgentHeader } from "@/components/agent-header";
import { AgentSidebar } from "@/components/agent-sidebar";
import { ChatInputBar } from "@/components/chat-input-bar";
import { ChatMessages } from "@/components/chat-messages";
import { DiffView } from "@/components/diff-view";
import {
	Sidebar,
	SidebarInset,
	SidebarProvider,
	SidebarRail,
} from "@/components/ui/sidebar";
import { useChatSession } from "@/hooks/use-chat-session";
import type { SessionHistoryItem } from "@/lib/session-history";

function makeThreadId(): string {
	return `thread_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

type Thread = {
	id: string;
	historySession?: SessionHistoryItem;
};

type WorkspaceSessionItem = {
	cwd?: string;
	workspaceRoot?: string;
};

function toThreadTitle(prompt?: string): string {
	const line = prompt?.trim().split("\n")[0]?.trim();
	if (line) return line.slice(0, 70);
	return "New session";
}

export default function Home() {
	const [threads, setThreads] = useState<Thread[]>(() => [
		{ id: makeThreadId() },
	]);
	const [activeThreadId, setActiveThreadId] = useState<string>(
		() => threads[0]!.id,
	);
	const handleNewThread = useCallback(() => {
		const id = makeThreadId();
		setThreads((prev) => [...prev, { id }]);
		setActiveThreadId(id);
	}, []);

	const handleOpenSession = useCallback((session: SessionHistoryItem) => {
		const threadId = `session_${session.sessionId}`;
		setThreads((prev) => {
			const existingIdx = prev.findIndex((item) => item.id === threadId);
			if (existingIdx >= 0) {
				const next = [...prev];
				next[existingIdx] = {
					...next[existingIdx],
					historySession: session,
				};
				return next;
			}
			return [...prev, { id: threadId, historySession: session }];
		});
		setActiveThreadId(threadId);
	}, []);

	const handleDeleteSession = useCallback(
		(deletedSessionId: string) => {
			const historyThreadId = `session_${deletedSessionId}`;
			setThreads((prev) => {
				const next = prev.filter(
					(thread) =>
						thread.id !== historyThreadId &&
						thread.historySession?.sessionId !== deletedSessionId,
				);
				if (next.length === 0) {
					const fallback = { id: makeThreadId() };
					setActiveThreadId(fallback.id);
					return [fallback];
				}
				if (!next.some((thread) => thread.id === activeThreadId)) {
					setActiveThreadId(next[0]!.id);
				}
				return next;
			});
		},
		[activeThreadId],
	);

	const activeHistorySessionId =
		threads.find((thread) => thread.id === activeThreadId)?.historySession
			?.sessionId ?? null;
	const activeThread =
		threads.find((thread) => thread.id === activeThreadId) ?? threads[0];

	return (
		<SidebarProvider>
			<div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
				<Sidebar className="border-r border-sidebar-border" collapsible="icon">
					<AgentSidebar
						activeSessionId={activeHistorySessionId}
						onNewThread={handleNewThread}
						onOpenSession={handleOpenSession}
					/>
					<SidebarRail />
				</Sidebar>
				<SidebarInset className="min-h-0 min-w-0 overflow-hidden">
					{activeThread ? (
						<div className="flex min-h-0 flex-1 flex-col">
							<ChatThreadPane
								historySession={activeThread.historySession}
								threadId={activeThread.id}
								onDeleteSession={handleDeleteSession}
								onNewThread={handleNewThread}
							/>
						</div>
					) : null}
				</SidebarInset>
			</div>
		</SidebarProvider>
	);
}

function ChatThreadPane({
	threadId,
	historySession,
	onDeleteSession,
	onNewThread,
}: {
	threadId: string;
	historySession?: SessionHistoryItem;
	onDeleteSession?: (sessionId: string) => void;
	onNewThread?: () => void;
}) {
	const {
		sessionId,
		status,
		isHydratingSession,
		activeAssistantMessageId,
		config,
		messages,
		error,
		summary,
		fileDiffs,
		pendingToolApprovals,
		setConfig,
		sendPrompt,
		approveToolApproval,
		rejectToolApproval,
		reset,
		abort,
		hydrateSession,
	} = useChatSession();
	const [promptInput, setPromptInput] = useState("");
	const [pendingAttachments, setPendingAttachments] = useState<File[]>([]);
	const [showDiffView, setShowDiffView] = useState(false);
	const [deletingSession, setDeletingSession] = useState(false);
	const [gitBranch, setGitBranch] = useState("no-git");
	const hydratedSessionRef = useRef<string | null>(null);
	const resetThreadRef = useRef<string | null>(null);

	const refreshGitBranch = useCallback(async () => {
		try {
			const payload = await invoke<{ branch?: string }>("get_git_branch", {
				cwd: config.cwd || config.workspaceRoot || undefined,
			});
			const branch = payload?.branch?.trim();
			setGitBranch(branch && branch.length > 0 ? branch : "no-git");
		} catch {
			setGitBranch("no-git");
		}
	}, [config.cwd, config.workspaceRoot]);

	const listGitBranches = useCallback(async (): Promise<{
		current: string;
		branches: string[];
	}> => {
		try {
			const payload = await invoke<{ current?: string; branches?: string[] }>(
				"list_git_branches",
				{
					cwd: config.cwd || config.workspaceRoot || undefined,
				},
			);
			const current = payload?.current?.trim() || "no-git";
			const branches = Array.isArray(payload?.branches)
				? payload.branches.filter((item) => item.trim().length > 0)
				: [];
			return { current, branches };
		} catch {
			return { current: "no-git", branches: [] };
		}
	}, [config.cwd, config.workspaceRoot]);

	const switchGitBranch = useCallback(
		async (nextBranch: string): Promise<boolean> => {
			try {
				const payload = await invoke<{ branch?: string }>(
					"checkout_git_branch",
					{
						cwd: config.cwd || config.workspaceRoot || undefined,
						branch: nextBranch,
					},
				);
				const branch = payload?.branch?.trim();
				setGitBranch(branch && branch.length > 0 ? branch : "no-git");
				return true;
			} catch {
				return false;
			}
		},
		[config.cwd, config.workspaceRoot],
	);

	const listWorkspaces = useCallback(async (): Promise<string[]> => {
		const roots = new Set<string>();
		const current = (config.workspaceRoot || config.cwd || "").trim();
		if (current) {
			roots.add(current);
		}

		try {
			const [cliDiscovered, chatDiscovered] = await Promise.all([
				invoke<WorkspaceSessionItem[]>("list_cli_sessions", {
					limit: 300,
				}).catch(() => []),
				invoke<WorkspaceSessionItem[]>("list_chat_sessions", {
					limit: 300,
				}).catch(() => []),
			]);

			for (const session of [...chatDiscovered, ...cliDiscovered]) {
				const candidate = (session.workspaceRoot || session.cwd || "").trim();
				if (candidate) {
					roots.add(candidate);
				}
			}
		} catch {
			// Keep fallback to current workspace when history is unavailable.
		}

		return [...roots].sort((a, b) => a.localeCompare(b));
	}, [config.cwd, config.workspaceRoot]);

	const switchWorkspace = useCallback(
		async (workspacePath: string): Promise<boolean> => {
			const nextWorkspace = workspacePath.trim();
			if (!nextWorkspace) {
				return false;
			}

			setConfig((prev) => ({
				...prev,
				workspaceRoot: nextWorkspace,
				cwd: nextWorkspace,
			}));

			try {
				const payload = await invoke<{ branch?: string }>("get_git_branch", {
					cwd: nextWorkspace,
				});
				const branch = payload?.branch?.trim();
				setGitBranch(branch && branch.length > 0 ? branch : "no-git");
			} catch {
				setGitBranch("no-git");
			}

			return true;
		},
		[setConfig],
	);

	useEffect(() => {
		void refreshGitBranch();
	}, [refreshGitBranch]);

	useEffect(() => {
		if (historySession) {
			resetThreadRef.current = null;
			return;
		}
		if (resetThreadRef.current === threadId) {
			return;
		}
		resetThreadRef.current = threadId;
		hydratedSessionRef.current = null;
		setPromptInput("");
		setPendingAttachments([]);
		void reset();
	}, [historySession, reset, threadId]);

	useEffect(() => {
		if (!historySession) {
			return;
		}
		if (hydratedSessionRef.current === historySession.sessionId) {
			return;
		}
		hydratedSessionRef.current = historySession.sessionId;
		setPromptInput("");
		setPendingAttachments([]);
		void hydrateSession(historySession);
	}, [historySession, hydrateSession]);

	const handleSend = useCallback(async () => {
		const trimmed = promptInput.trim();
		if (!trimmed && pendingAttachments.length === 0) {
			return;
		}
		setPromptInput("");
		const toSend = [...pendingAttachments];
		setPendingAttachments([]);
		await sendPrompt(trimmed, toSend);
	}, [pendingAttachments, promptInput, sendPrompt]);

	const activeSessionToDelete = sessionId ?? historySession?.sessionId ?? null;

	const handleDeleteSession = useCallback(async () => {
		if (!activeSessionToDelete || deletingSession) {
			return;
		}
		if (!window.confirm("Delete this session permanently?")) {
			return;
		}

		setDeletingSession(true);
		try {
			await invoke("delete_chat_session", {
				sessionId: activeSessionToDelete,
			});
			setPromptInput("");
			setPendingAttachments([]);
			setShowDiffView(false);
			await reset();
			onDeleteSession?.(activeSessionToDelete);
		} catch {
			// Keep current state when deletion fails.
		} finally {
			setDeletingSession(false);
		}
	}, [activeSessionToDelete, deletingSession, onDeleteSession, reset]);

	const attachmentList = pendingAttachments.map((file, index) => ({
		id: `${file.name}:${file.size}:${file.lastModified}:${index}`,
		name: file.name,
		isImage: file.type.startsWith("image/"),
	}));

	const firstUserMessage = messages.find(
		(message) => message.role === "user",
	)?.content;
	const threadTitle = toThreadTitle(historySession?.prompt ?? firstUserMessage);
	const hasDiffChanges = summary.additions + summary.deletions > 0;

	useEffect(() => {
		if (!hasDiffChanges) {
			setShowDiffView(false);
		}
	}, [hasDiffChanges]);

	return (
		<div className="grid h-full min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
			<div className="z-20">
				<AgentHeader
					canDeleteSession={Boolean(activeSessionToDelete)}
					deletingSession={deletingSession}
					diff={{ additions: summary.additions, deletions: summary.deletions }}
					onDeleteSession={() => void handleDeleteSession()}
					onNewThread={onNewThread}
					onOpenDiff={() => {
						if (hasDiffChanges) {
							setShowDiffView(true);
						}
					}}
					status={status}
					title={threadTitle}
				/>
			</div>
			<div className="h-full min-h-0 overflow-hidden">
				{showDiffView ? (
					<DiffView
						fileDiffs={fileDiffs}
						onClose={() => setShowDiffView(false)}
					/>
				) : (
					<ChatMessages
						onApproveToolApproval={(requestId) =>
							void approveToolApproval(requestId)
						}
						onRejectToolApproval={(requestId) =>
							void rejectToolApproval(requestId)
						}
						error={error}
						messages={messages}
						model={config.model}
						pendingToolApprovals={pendingToolApprovals}
						onPromptInputChange={setPromptInput}
						onSend={() => void handleSend()}
						promptInput={promptInput}
						provider={config.provider}
						sessionId={sessionId}
						streamingMessageId={activeAssistantMessageId}
						isSessionSwitching={isHydratingSession}
						status={status}
					/>
				)}
			</div>
			<div className="z-20 shrink-0">
				<ChatInputBar
					attachments={attachmentList}
					onAbort={() => void abort()}
					onAttachFiles={(files) => {
						setPendingAttachments((prev) => {
							const existing = new Set(
								prev.map(
									(file) => `${file.name}:${file.size}:${file.lastModified}`,
								),
							);
							const next = [...prev];
							for (const file of files) {
								const key = `${file.name}:${file.size}:${file.lastModified}`;
								if (!existing.has(key)) {
									existing.add(key);
									next.push(file);
								}
							}
							return next;
						});
					}}
					onListGitBranches={listGitBranches}
					onListWorkspaces={listWorkspaces}
					onRemoveAttachment={(id) => {
						setPendingAttachments((prev) =>
							prev.filter((file, index) => {
								const fileId = `${file.name}:${file.size}:${file.lastModified}:${index}`;
								return fileId !== id;
							}),
						);
					}}
					onSwitchGitBranch={switchGitBranch}
					onSwitchWorkspace={switchWorkspace}
					onRefreshGitBranch={() => void refreshGitBranch()}
					onModelChange={(nextModel) =>
						setConfig((prev) => ({ ...prev, model: nextModel }))
					}
					onModeToggle={() =>
						setConfig((prev) => ({
							...prev,
							mode: prev.mode === "plan" ? "act" : "plan",
						}))
					}
					onPromptInputChange={setPromptInput}
					onProviderChange={(nextProvider) =>
						setConfig((prev) => ({ ...prev, provider: nextProvider }))
					}
					onReset={() => {
						setPendingAttachments([]);
						void reset();
					}}
					onSend={() => void handleSend()}
					gitBranch={gitBranch}
					model={config.model}
					mode={config.mode}
					promptInput={promptInput}
					provider={config.provider}
					status={status}
					summary={summary}
					workspaceRoot={config.workspaceRoot || config.cwd || ""}
				/>
			</div>
		</div>
	);
}
