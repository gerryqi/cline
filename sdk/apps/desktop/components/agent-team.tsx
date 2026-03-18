"use client";

import { invoke } from "@tauri-apps/api/core";
import {
	ChevronDown,
	ChevronLeft,
	ChevronUp,
	Play,
	RefreshCw,
	RotateCcw,
	Send,
	Square,
	Users,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { UserNav } from "@/components/user-nav";
import { useAgentSession } from "@/hooks/use-agent-session";
import { stripAnsi } from "@/lib/parse";
import { createTeamName } from "@/lib/team-name";
import { buildTeamStatusBoardDto } from "@/lib/team-status-board";
import type { StartSessionRequest } from "@/lib/types";
import { cn } from "@/lib/utils";

const TAB_NAMES = [
	"Members",
	"Tasks",
	"Runs",
	"Outcomes",
	"Mailbox",
	"Mission Log",
] as const;
type ActiveTab = (typeof TAB_NAMES)[number];

type ProcessContext = {
	workspaceRoot: string;
	cwd: string;
};

function taskStatusIcon(status: string) {
	const normalized = status.toLowerCase();
	if (normalized.includes("done") || normalized.includes("complete"))
		return "check";
	if (normalized.includes("block")) return "alert";
	if (normalized.includes("progress") || normalized.includes("active"))
		return "pulse";
	return "circle";
}

function missionIcon(kind: string) {
	const normalized = kind.toLowerCase();
	if (normalized.includes("progress")) return "trending-up";
	if (normalized.includes("handoff")) return "arrow-right-left";
	if (normalized.includes("decision")) return "diamond";
	if (normalized.includes("done")) return "check";
	if (normalized.includes("blocked")) return "alert";
	if (normalized.includes("error")) return "x";
	return "dot";
}

function missionColor(kind: string) {
	const normalized = kind.toLowerCase();
	if (normalized.includes("progress")) return "text-chart-5";
	if (normalized.includes("handoff")) return "text-chart-3";
	if (normalized.includes("decision")) return "text-primary";
	if (normalized.includes("done")) return "text-success";
	if (normalized.includes("blocked") || normalized.includes("error"))
		return "text-destructive";
	return "text-muted-foreground";
}

export function AgentTeam() {
	const {
		sessionId,
		isRunning,
		rawTranscript,
		teamState,
		teamHistory,
		existingTeams,
		error,
		start,
		stop,
		reset,
		sendPrompt,
		refreshTeam,
		refreshTeams,
	} = useAgentSession();

	const [prompt, setPrompt] = useState("");
	const [activeTab, setActiveTab] = useState<ActiveTab>("Members");
	const [userMessages, setUserMessages] = useState<
		Array<{ ts: number; text: string }>
	>([]);
	const [isConsoleCollapsed, setIsConsoleCollapsed] = useState(false);
	const [form, setForm] = useState<StartSessionRequest>({
		workspaceRoot: "",
		cwd: "",
		provider: "cline",
		model: "anthropic/claude-sonnet-4-6",
		apiKey: "",
		systemPrompt: undefined,
		maxIterations: undefined,
		enableTools: true,
		enableSpawn: true,
		enableTeams: true,
		autoApproveTools: true,
		teamName: createTeamName(),
		missionStepInterval: 3,
		missionTimeIntervalMs: 120000,
	});
	const [workspaceDraft, setWorkspaceDraft] = useState({
		workspaceRoot: "",
		cwd: "",
	});
	const transcriptRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		let active = true;
		invoke<ProcessContext>("get_process_context")
			.then((ctx) => {
				if (!active) {
					return;
				}
				setForm((prev) => ({
					...prev,
					workspaceRoot: ctx.workspaceRoot,
					cwd: ctx.cwd || ctx.workspaceRoot,
				}));
				setWorkspaceDraft({
					workspaceRoot: ctx.workspaceRoot,
					cwd: ctx.cwd || ctx.workspaceRoot,
				});
			})
			.catch((err) => {
				console.error("failed to load process context", err);
			});
		return () => {
			active = false;
		};
	}, []);

	useEffect(() => {
		void refreshTeams();
	}, [refreshTeams]);

	useEffect(() => {
		void refreshTeam(form.teamName);
	}, [form.teamName, refreshTeam]);

	useEffect(() => {
		if (!isRunning || !form.teamName.trim()) {
			return;
		}
		const timer = setInterval(() => {
			void refreshTeam(form.teamName);
		}, 2000);
		return () => clearInterval(timer);
	}, [isRunning, form.teamName, refreshTeam]);

	useEffect(() => {
		if (isRunning) {
			setIsConsoleCollapsed(true);
		}
	}, [isRunning]);

	const team = teamState?.teamState;
	const statusBoard = useMemo(
		() => buildTeamStatusBoardDto(teamState),
		[teamState],
	);
	const normalizedTranscript = useMemo(
		() => stripAnsi(rawTranscript).replace(/\r/g, "\n"),
		[rawTranscript],
	);
	const transcriptEntryCount = useMemo(
		() =>
			userMessages.length + (normalizedTranscript.trim().length > 0 ? 1 : 0),
		[userMessages, normalizedTranscript],
	);
	const [teammateFilter, setTeammateFilter] = useState<string>("all");
	const teammateOptions = useMemo(() => {
		const ids = new Set<string>();
		for (const member of team?.members ?? []) {
			if (member.agentId) {
				ids.add(member.agentId);
			}
		}
		for (const item of team?.missionLog ?? []) {
			if (item.agentId) {
				ids.add(item.agentId);
			}
		}
		for (const item of team?.mailbox ?? []) {
			if (item.fromAgentId) {
				ids.add(item.fromAgentId);
			}
			if (item.toAgentId) {
				ids.add(item.toAgentId);
			}
		}
		for (const item of teamHistory) {
			const task = item.task as { agentId?: string };
			if (task.agentId) {
				ids.add(task.agentId);
			}
		}
		return Array.from(ids).sort((a, b) => a.localeCompare(b));
	}, [team?.members, team?.missionLog, team?.mailbox, teamHistory]);
	const filteredMembers = useMemo(() => {
		const members = team?.members ?? [];
		if (teammateFilter === "all") {
			return members;
		}
		return members.filter((member) => member.agentId === teammateFilter);
	}, [team?.members, teammateFilter]);
	const filteredTasks = useMemo(() => {
		const tasks = team?.tasks ?? [];
		if (teammateFilter === "all") {
			return tasks;
		}
		return tasks.filter(
			(task) =>
				task.assignee === teammateFilter || task.createdBy === teammateFilter,
		);
	}, [team?.tasks, teammateFilter]);
	const filteredMailbox = useMemo(() => {
		const mailbox = team?.mailbox ?? [];
		if (teammateFilter === "all") {
			return mailbox;
		}
		return mailbox.filter(
			(mail) =>
				mail.fromAgentId === teammateFilter ||
				mail.toAgentId === teammateFilter,
		);
	}, [team?.mailbox, teammateFilter]);
	const filteredRuns = useMemo(() => {
		const runs = team?.runs ?? [];
		if (teammateFilter === "all") {
			return runs;
		}
		return runs.filter((run) => run.agentId === teammateFilter);
	}, [team?.runs, teammateFilter]);
	const filteredOutcomes = useMemo(() => {
		const outcomes = team?.outcomes ?? [];
		if (teammateFilter === "all") {
			return outcomes;
		}
		const runs = team?.runs ?? [];
		const runById = new Map(runs.map((run) => [run.id, run] as const));
		const fragments = team?.outcomeFragments ?? [];
		const allowedOutcomeIds = new Set(
			fragments
				.filter((fragment) => {
					if (fragment.sourceAgentId === teammateFilter) {
						return true;
					}
					const runId = fragment.sourceRunId;
					if (!runId) {
						return false;
					}
					return runById.get(runId)?.agentId === teammateFilter;
				})
				.map((fragment) => fragment.outcomeId),
		);
		return outcomes.filter((outcome) => allowedOutcomeIds.has(outcome.id));
	}, [team?.outcomes, team?.runs, team?.outcomeFragments, teammateFilter]);
	const filteredMissionLog = useMemo(() => {
		const missionLog = team?.missionLog ?? [];
		if (teammateFilter === "all") {
			return missionLog;
		}
		return missionLog.filter((item) => item.agentId === teammateFilter);
	}, [team?.missionLog, teammateFilter]);
	const filteredHistory = useMemo(() => {
		const recentHistory = teamHistory.slice(-20).reverse();
		if (teammateFilter === "all") {
			return recentHistory;
		}
		return recentHistory.filter((item) => {
			const task = item.task as { agentId?: string };
			return task.agentId === teammateFilter;
		});
	}, [teamHistory, teammateFilter]);

	useEffect(() => {
		if (!transcriptRef.current || !normalizedTranscript) {
			return;
		}
		transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
	}, [normalizedTranscript]);

	async function handleSendPrompt() {
		const next = prompt.trim();
		if (!isRunning || !next) {
			return;
		}
		const ts = Date.now();
		setUserMessages((prev) => [...prev, { ts, text: next }]);
		setPrompt("");
		await sendPrompt(next);
	}

	async function handleReset() {
		await reset();
		setPrompt("");
		setUserMessages([]);
		setIsConsoleCollapsed(false);
	}

	async function handleStart() {
		const nextTeamName = form.enableTeams
			? form.teamName.trim() || createTeamName()
			: form.teamName;
		const nextForm: StartSessionRequest = {
			...form,
			teamName: nextTeamName,
		};
		setForm(nextForm);
		await start(nextForm);
	}

	function handleApplyWorkspace() {
		const nextRoot = workspaceDraft.workspaceRoot.trim();
		const nextCwd = workspaceDraft.cwd.trim() || nextRoot;
		if (!nextRoot) {
			return;
		}
		setForm((prev) => ({
			...prev,
			workspaceRoot: nextRoot,
			cwd: nextCwd,
		}));
	}

	function handleCancelWorkspaceChange() {
		setWorkspaceDraft({
			workspaceRoot: form.workspaceRoot,
			cwd: form.cwd ?? form.workspaceRoot,
		});
	}

	return (
		<div className="flex min-h-[100dvh] flex-col">
			<header className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-6">
				<div className="flex items-center gap-3">
					<Link
						aria-label="Back to home"
						className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground sm:h-9 sm:w-9"
						href="/"
					>
						<ChevronLeft className="h-4 w-4" />
					</Link>
					<div className="flex h-8 w-8 items-center justify-center rounded-lg bg-success/10 sm:h-9 sm:w-9">
						<Users className="h-4 w-4 text-success sm:h-5 sm:w-5" />
					</div>
					<div>
						<h1 className="text-base font-semibold text-foreground sm:text-lg">
							Agent Team
						</h1>
						<p className="text-[10px] text-muted-foreground sm:text-xs">
							Live team-agent session console
						</p>
					</div>
				</div>
				<div className="flex items-center gap-2">
					<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
						<span
							className={cn(
								"inline-flex h-2 w-2 rounded-full",
								isRunning
									? "animate-pulse-dot bg-success"
									: "bg-muted-foreground",
							)}
						/>
						<span className="hidden sm:inline">
							{isRunning ? "Running" : "Idle"}
						</span>
					</div>
					{sessionId && (
						<span className="hidden rounded-md border border-border bg-background px-2 py-1 font-mono text-[10px] text-muted-foreground sm:inline-block">
							{sessionId}
						</span>
					)}
					<UserNav size="sm" />
				</div>
			</header>

			<main className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
				<section className="rounded-xl border border-border bg-card p-4">
					<div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
						<div>
							<h2 className="text-sm font-semibold text-foreground">
								Session Console
							</h2>
							<p className="text-xs text-muted-foreground">
								Configure and control live team-agent sessions.
							</p>
						</div>
						<Button
							className="h-7 gap-1.5 text-xs text-muted-foreground"
							onClick={() => setIsConsoleCollapsed((p) => !p)}
							size="sm"
							variant="ghost"
						>
							{isConsoleCollapsed ? "Show Config" : "Hide Config"}
							{isConsoleCollapsed ? (
								<ChevronDown className="h-3 w-3" />
							) : (
								<ChevronUp className="h-3 w-3" />
							)}
						</Button>
					</div>

					{!isConsoleCollapsed && (
						<>
							<div className="grid gap-3 md:grid-cols-4">
								<label className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">
									Tools
									<input
										checked={form.enableTools}
										className="h-4 w-4 accent-primary"
										onChange={(e) =>
											setForm((f) => ({ ...f, enableTools: e.target.checked }))
										}
										type="checkbox"
									/>
								</label>
								<label className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">
									Spawn
									<input
										checked={form.enableSpawn}
										className="h-4 w-4 accent-primary"
										onChange={(e) =>
											setForm((f) => ({ ...f, enableSpawn: e.target.checked }))
										}
										type="checkbox"
									/>
								</label>
								<label className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">
									Teams
									<input
										checked={form.enableTeams}
										className="h-4 w-4 accent-primary"
										onChange={(e) =>
											setForm((f) => ({ ...f, enableTeams: e.target.checked }))
										}
										type="checkbox"
									/>
								</label>
								<label className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">
									Auto-Approve
									<input
										checked={form.autoApproveTools !== false}
										className="h-4 w-4 accent-primary"
										onChange={(e) =>
											setForm((f) => ({
												...f,
												autoApproveTools: e.target.checked,
											}))
										}
										type="checkbox"
									/>
								</label>
							</div>

							<div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
								<label className="text-xs text-muted-foreground">
									Provider
									<input
										className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-2 text-sm text-foreground outline-none ring-primary/60 focus:ring-1"
										onChange={(e) =>
											setForm((f) => ({ ...f, provider: e.target.value }))
										}
										value={form.provider}
									/>
								</label>
								<label className="text-xs text-muted-foreground">
									Model
									<input
										className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-2 text-sm text-foreground outline-none ring-primary/60 focus:ring-1"
										onChange={(e) =>
											setForm((f) => ({ ...f, model: e.target.value }))
										}
										value={form.model}
									/>
								</label>
								<label className="text-xs text-muted-foreground">
									Team Name
									<input
										className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-2 text-sm text-foreground outline-none ring-primary/60 focus:ring-1"
										onChange={(e) =>
											setForm((f) => ({ ...f, teamName: e.target.value }))
										}
										value={form.teamName}
									/>
								</label>
								<label className="text-xs text-muted-foreground">
									Existing Teams
									<select
										className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-2 text-sm text-foreground outline-none ring-primary/60 focus:ring-1"
										onChange={(e) => {
											const next = e.target.value;
											if (next) {
												setForm((f) => ({ ...f, teamName: next }));
											}
										}}
										value={
											existingTeams.includes(form.teamName) ? form.teamName : ""
										}
									>
										<option value="">Select a saved team...</option>
										{existingTeams.map((teamName) => (
											<option key={teamName} value={teamName}>
												{teamName}
											</option>
										))}
									</select>
								</label>
								<label className="text-xs text-muted-foreground md:col-span-2 lg:col-span-1">
									API Key (optional)
									<input
										className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-2 text-sm text-foreground outline-none ring-primary/60 focus:ring-1"
										onChange={(e) =>
											setForm((f) => ({ ...f, apiKey: e.target.value }))
										}
										placeholder=""
										type="password"
										value={form.apiKey}
									/>
								</label>
							</div>
						</>
					)}

					<div className="mt-4 flex flex-wrap gap-2">
						<Button
							className="gap-1.5"
							disabled={isRunning}
							onClick={() => void handleStart()}
							size="sm"
						>
							<Play className="h-3 w-3" />
							Start
						</Button>
						<Button
							className="gap-1.5"
							disabled={!isRunning}
							onClick={() => void stop()}
							size="sm"
							variant="secondary"
						>
							<Square className="h-3 w-3" />
							Stop
						</Button>
						<Button
							className="gap-1.5"
							onClick={() => void handleReset()}
							size="sm"
							variant="outline"
						>
							<RotateCcw className="h-3 w-3" />
							Reset
						</Button>
						<Button
							className="gap-1.5"
							onClick={() => {
								void refreshTeam(form.teamName);
								void refreshTeams();
							}}
							size="sm"
							variant="outline"
						>
							<RefreshCw className="h-3 w-3" />
							Refresh Team
						</Button>
					</div>
				</section>

				{(teamHistory.length > 0 || !!teamState) && (
					<section className="grid gap-4 lg:grid-cols-5">
						<div className="rounded-xl border border-border bg-card p-4 lg:col-span-3">
							<div className="mb-3 flex items-center justify-between">
								<h2 className="text-sm font-semibold text-foreground">
									Live Transcript
								</h2>
								<span className="text-[10px] text-muted-foreground">
									{transcriptEntryCount} entries
								</span>
							</div>
							<div
								className="h-[46vh] min-h-[280px] overflow-auto rounded-lg border border-border bg-background p-3 scrollbar-hide"
								ref={transcriptRef}
							>
								{transcriptEntryCount === 0 ? (
									<p className="text-sm text-muted-foreground">
										No transcript activity yet.
									</p>
								) : (
									<div className="flex flex-col gap-2 text-sm">
										{userMessages.map((entry) => (
											<div
												className="rounded-lg border border-chart-5/30 bg-chart-5/5 px-3 py-2"
												key={entry.ts}
											>
												<div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-muted-foreground">
													<span>user</span>
													<span>{new Date(entry.ts).toLocaleTimeString()}</span>
												</div>
												<p className="font-mono text-xs leading-relaxed text-foreground whitespace-pre-wrap">
													{entry.text}
												</p>
											</div>
										))}
										{normalizedTranscript.trim().length > 0 && (
											<div className="rounded-lg border border-success/30 bg-success/5 px-3 py-2">
												<div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
													agent stream
												</div>
												<pre className="font-mono text-xs leading-relaxed text-foreground whitespace-pre-wrap">
													{normalizedTranscript}
												</pre>
											</div>
										)}
									</div>
								)}
							</div>
							<div className="mt-3 flex gap-2">
								<textarea
									className="h-20 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none ring-primary/60 placeholder:text-muted-foreground focus:ring-1"
									onChange={(e) => setPrompt(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === "Enter" && !e.shiftKey) {
											e.preventDefault();
											void handleSendPrompt();
										}
									}}
									placeholder="Type a prompt. Enter sends, Shift+Enter for newline."
									value={prompt}
								/>
								<Button
									className="h-fit gap-1.5"
									disabled={!isRunning || !prompt.trim()}
									onClick={() => void handleSendPrompt()}
									size="sm"
								>
									<Send className="h-3 w-3" />
									Send
								</Button>
							</div>
						</div>

						<div className="rounded-xl border border-border bg-card p-4 lg:col-span-2">
							<h2 className="mb-3 text-sm font-semibold text-foreground">
								Team Panels: {form.teamName || "(unset)"} ({teamHistory.length})
							</h2>
							<div className="mb-3 grid grid-cols-2 gap-2 text-[11px]">
								<div className="rounded-lg border border-border bg-card px-2 py-1.5 text-muted-foreground">
									members {statusBoard.members.running}/
									{statusBoard.members.total} running
								</div>
								<div className="rounded-lg border border-border bg-card px-2 py-1.5 text-muted-foreground">
									tasks {statusBoard.tasks.completed}/{statusBoard.tasks.total}{" "}
									done
								</div>
								<div className="rounded-lg border border-border bg-card px-2 py-1.5 text-muted-foreground">
									runs {statusBoard.runs.running} active /{" "}
									{statusBoard.runs.queued} queued
								</div>
								<div className="rounded-lg border border-border bg-card px-2 py-1.5 text-muted-foreground">
									outcomes {statusBoard.outcomes.finalized}/
									{statusBoard.outcomes.total} finalized
								</div>
							</div>
							<div className="mb-3">
								<label className="text-xs text-muted-foreground">
									Filter by teammate
									<select
										className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-2 text-sm text-foreground outline-none ring-primary/60 focus:ring-1"
										onChange={(e) => setTeammateFilter(e.target.value)}
										value={teammateFilter}
									>
										<option value="all">All teammates</option>
										{teammateOptions.map((agentId) => (
											<option key={agentId} value={agentId}>
												{agentId}
											</option>
										))}
									</select>
								</label>
							</div>

							<div className="mb-3 grid grid-cols-2 gap-2">
								{TAB_NAMES.map((tab) => (
									<button
										className={cn(
											"rounded-lg border px-3 py-2 text-xs font-medium transition-colors",
											activeTab === tab
												? "border-primary bg-primary/10 text-primary"
												: "border-border bg-background text-muted-foreground hover:text-foreground",
										)}
										key={tab}
										onClick={() => setActiveTab(tab)}
										type="button"
									>
										{tab}
									</button>
								))}
							</div>

							<div className="h-[46vh] min-h-[280px] overflow-auto rounded-lg border border-border bg-background p-3 text-sm scrollbar-hide">
								{activeTab === "Members" && (
									<ul className="flex flex-col gap-2">
										{filteredMembers.map((member) => (
											<li
												className="rounded-lg border border-border bg-card p-3"
												key={member.agentId}
											>
												<div className="flex items-center justify-between">
													<span className="font-medium text-foreground">
														{member.agentId}
														<span className="text-muted-foreground">
															{" "}
															- {member.role}
														</span>
													</span>
													<span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground">
														{member.status}
													</span>
												</div>
												<p className="mt-1 text-xs text-muted-foreground">
													{member.description ?? "No description provided."}
												</p>
											</li>
										))}
										{filteredMembers.length === 0 && (
											<p className="text-muted-foreground">
												No team members for this filter.
											</p>
										)}
									</ul>
								)}

								{activeTab === "Tasks" && (
									<ul className="flex flex-col gap-2">
										{filteredTasks.map((task) => (
											<li
												className="rounded-lg border border-border bg-card p-3"
												key={task.id}
											>
												<div className="flex items-center gap-2">
													<span
														className={cn(
															"h-2 w-2 shrink-0 rounded-full",
															taskStatusIcon(task.status) === "check"
																? "bg-success"
																: taskStatusIcon(task.status) === "pulse"
																	? "animate-pulse-dot bg-primary"
																	: taskStatusIcon(task.status) === "alert"
																		? "bg-destructive"
																		: "bg-muted-foreground",
														)}
													/>
													<p className="font-medium text-foreground">
														{task.title}
													</p>
												</div>
												<p className="mt-1 text-xs text-muted-foreground">
													{task.description}
												</p>
												<p className="mt-1 text-[10px] text-muted-foreground">
													Depends on:{" "}
													{task.dependsOn.length > 0
														? task.dependsOn.join(" -> ")
														: "none"}
												</p>
											</li>
										))}
										{filteredTasks.length === 0 && (
											<p className="text-muted-foreground">
												No tasks for this filter.
											</p>
										)}
									</ul>
								)}

								{activeTab === "Mailbox" && (
									<ul className="flex flex-col gap-2">
										{filteredMailbox.map((mail) => {
											const unread = !mail.readAt;
											return (
												<li
													className="rounded-lg border border-border bg-card p-3"
													key={mail.id}
												>
													<div className="mb-1 flex items-center justify-between">
														<p className="font-medium text-foreground">
															{mail.subject}
														</p>
														<span
															className={cn(
																"rounded-full px-2 py-0.5 text-[10px] font-medium",
																unread
																	? "bg-warning/10 text-warning"
																	: "bg-muted text-muted-foreground",
															)}
														>
															{unread ? "Unread" : "Read"}
														</span>
													</div>
													<p className="text-xs text-muted-foreground">
														from{" "}
														<span className="font-mono text-foreground">
															{mail.fromAgentId}
														</span>{" "}
														to{" "}
														<span className="font-mono text-foreground">
															{mail.toAgentId}
														</span>
													</p>
												</li>
											);
										})}
										{filteredMailbox.length === 0 && (
											<p className="text-muted-foreground">
												No mailbox items for this filter.
											</p>
										)}
									</ul>
								)}

								{activeTab === "Runs" && (
									<ul className="flex flex-col gap-2">
										{filteredRuns.map((run) => (
											<li
												className="rounded-lg border border-border bg-card p-3"
												key={run.id}
											>
												<div className="flex items-center justify-between gap-2">
													<p className="font-mono text-xs text-foreground">
														{run.id}
													</p>
													<span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground">
														{run.status}
													</span>
												</div>
												<p className="mt-1 text-xs text-muted-foreground">
													agent {run.agentId}
													{run.taskId ? ` · task ${run.taskId}` : ""}
												</p>
												<p className="mt-1 text-xs text-muted-foreground">
													{run.message}
												</p>
												{run.error ? (
													<p className="mt-1 text-xs text-destructive">
														{run.error}
													</p>
												) : null}
											</li>
										))}
										{filteredRuns.length === 0 && (
											<p className="text-muted-foreground">
												No runs for this filter.
											</p>
										)}
									</ul>
								)}

								{activeTab === "Outcomes" && (
									<ul className="flex flex-col gap-2">
										{filteredOutcomes.map((outcome) => (
											<li
												className="rounded-lg border border-border bg-card p-3"
												key={outcome.id}
											>
												<div className="flex items-center justify-between gap-2">
													<p className="font-medium text-foreground">
														{outcome.title}
													</p>
													<span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground">
														{outcome.status}
													</span>
												</div>
												<p className="mt-1 font-mono text-[10px] text-muted-foreground">
													{outcome.id}
												</p>
												<p className="mt-1 text-xs text-muted-foreground">
													required sections:{" "}
													{outcome.requiredSections.join(", ") || "none"}
												</p>
											</li>
										))}
										{filteredOutcomes.length === 0 && (
											<p className="text-muted-foreground">
												No outcomes for this filter.
											</p>
										)}
									</ul>
								)}

								{activeTab === "Mission Log" && (
									<ul className="flex flex-col gap-2">
										{filteredMissionLog.map((item) => (
											<li
												className="rounded-lg border border-border bg-card p-3"
												key={item.id}
											>
												<div className="flex items-center gap-2">
													<span
														className={cn(
															"text-xs font-semibold",
															missionColor(item.kind),
														)}
													>
														{missionIcon(item.kind) === "check"
															? "done"
															: item.kind}
													</span>
													<span className="font-mono text-[10px] text-muted-foreground">
														{item.agentId}
													</span>
												</div>
												<p className="mt-1 text-xs text-muted-foreground">
													{item.summary}
												</p>
												<p className="mt-1 text-[10px] text-muted-foreground">
													{new Date(item.ts).toLocaleTimeString()}
												</p>
											</li>
										))}
										{filteredMissionLog.length === 0 && (
											<p className="text-muted-foreground">
												No mission logs for this filter.
											</p>
										)}
									</ul>
								)}

								{activeTab === "Mission Log" &&
									filteredMissionLog.length === 0 &&
									filteredHistory.length > 0 && (
										<ul className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
											{filteredHistory.map((item) => {
												const task = item.task as {
													agentId?: string;
													id?: string;
													title?: string;
													status?: string;
												};
												return (
													<li
														className="rounded-lg border border-border bg-card p-3"
														key={`${item.ts}-${task.id ?? task.title ?? item.type}`}
													>
														<div className="flex items-center justify-between">
															<p className="font-medium text-foreground">
																{task.title ?? task.id ?? item.type}
															</p>
															<span className="text-xs text-muted-foreground">
																{item.type}
															</span>
														</div>
														<p className="mt-1 text-xs text-muted-foreground">
															{item.ts
																? new Date(item.ts).toLocaleString()
																: "Timestamp unavailable"}
														</p>
														{task.status ? (
															<p className="mt-1 text-xs text-muted-foreground">
																Status: {task.status}
															</p>
														) : null}
													</li>
												);
											})}
										</ul>
									)}
							</div>
						</div>
					</section>
				)}

				{error ? (
					<section className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
						{error}
					</section>
				) : null}

				<section className="rounded-xl border border-border bg-card p-3 text-xs text-muted-foreground">
					<div className="flex items-center justify-center gap-2">
						<input
							className="w-full rounded-lg border border-border bg-background px-2 py-2 text-sm text-foreground outline-none ring-primary/60 focus:ring"
							onChange={(e) => {
								setWorkspaceDraft((prev) => ({
									...prev,
									workspaceRoot: e.target.value,
								}));
							}}
							onMouseLeave={() => {
								setWorkspaceDraft({
									workspaceRoot: form.workspaceRoot,
									cwd: form.cwd ?? form.workspaceRoot,
								});
							}}
							value={workspaceDraft.workspaceRoot}
						/>
						{form.workspaceRoot !== workspaceDraft.workspaceRoot && (
							<div className="flex gap-2">
								<Button
									disabled={!workspaceDraft.workspaceRoot.trim()}
									onClick={handleApplyWorkspace}
									size="sm"
									type="button"
								>
									Change
								</Button>
								<Button
									onClick={handleCancelWorkspaceChange}
									size="sm"
									type="button"
									variant="outline"
								>
									Cancel
								</Button>
							</div>
						)}
					</div>
				</section>
			</main>
		</div>
	);
}
