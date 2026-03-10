"use client";

import { invoke } from "@tauri-apps/api/core";
import {
	Circle,
	Eye,
	Pause,
	Play,
	Plus,
	RefreshCw,
	Trash2,
	Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface RoutineSchedule {
	scheduleId: string;
	name: string;
	cronPattern: string;
	prompt: string;
	provider: string;
	model: string;
	mode: "act" | "plan";
	workspaceRoot?: string;
	cwd?: string;
	systemPrompt?: string;
	maxIterations?: number;
	timeoutSeconds?: number;
	maxParallel: number;
	enabled: boolean;
	createdAt: string;
	updatedAt: string;
	lastRunAt?: string;
	nextRunAt?: string;
	tags?: string[];
}

interface RoutineExecution {
	executionId: string;
	scheduleId: string;
	sessionId?: string;
	startedAt: string;
	timeoutAt?: string;
}

interface RoutineUpcomingRun {
	scheduleId: string;
	name: string;
	nextRunAt: string;
}

interface RoutineOverviewResponse {
	schedules: RoutineSchedule[];
	activeExecutions: RoutineExecution[];
	upcomingRuns: RoutineUpcomingRun[];
}

interface ProcessContext {
	workspaceRoot: string;
	cwd: string;
}

interface RoutineFormState {
	name: string;
	cronPattern: string;
	prompt: string;
	provider: string;
	model: string;
	mode: "act" | "plan";
	workspaceRoot: string;
	cwd: string;
	systemPrompt: string;
	maxIterations: string;
	timeoutSeconds: string;
	maxParallel: string;
	tags: string;
	enabled: boolean;
}

function formatDateTime(value?: string): string {
	if (!value || value.trim().length === 0) {
		return "-";
	}
	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) {
		return value;
	}
	return parsed.toLocaleString();
}

function parseOptionalPositiveInt(text: string): number | undefined {
	const trimmed = text.trim();
	if (!trimmed) {
		return undefined;
	}
	const value = Number.parseInt(trimmed, 10);
	if (!Number.isFinite(value) || value <= 0) {
		return undefined;
	}
	return value;
}

function parseTags(text: string): string[] | undefined {
	const tags = text
		.split(",")
		.map((value) => value.trim())
		.filter((value) => value.length > 0);
	return tags.length > 0 ? tags : undefined;
}

export function RoutineSchedulesContent() {
	const [schedules, setSchedules] = useState<RoutineSchedule[]>([]);
	const [activeExecutions, setActiveExecutions] = useState<RoutineExecution[]>(
		[],
	);
	const [upcomingRuns, setUpcomingRuns] = useState<RoutineUpcomingRun[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [busyScheduleId, setBusyScheduleId] = useState<string | null>(null);
	const [isCreateOpen, setIsCreateOpen] = useState(false);
	const [isCreating, setIsCreating] = useState(false);
	const [createFormError, setCreateFormError] = useState<string | null>(null);
	const [createForm, setCreateForm] = useState<RoutineFormState>({
		name: "",
		cronPattern: "0 9 * * MON-FRI",
		prompt: "Review PRs opened yesterday and summarize issues.",
		provider: "cline",
		model: "openai/gpt-5.3-codex",
		mode: "act",
		workspaceRoot: "",
		cwd: "",
		systemPrompt: "",
		maxIterations: "",
		timeoutSeconds: "",
		maxParallel: "1",
		tags: "",
		enabled: true,
	});

	const refreshSchedules = useCallback(async () => {
		setIsLoading(true);
		setErrorMessage(null);
		try {
			const response = await invoke<RoutineOverviewResponse>(
				"list_routine_schedules",
			);
			setSchedules(response.schedules ?? []);
			setActiveExecutions(response.activeExecutions ?? []);
			setUpcomingRuns(response.upcomingRuns ?? []);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setErrorMessage(message);
		} finally {
			setIsLoading(false);
		}
	}, []);

	useEffect(() => {
		void refreshSchedules();
	}, [refreshSchedules]);

	const upsertScheduleEnabled = async (
		schedule: RoutineSchedule,
		enabled: boolean,
	) => {
		setBusyScheduleId(schedule.scheduleId);
		setErrorMessage(null);
		try {
			if (enabled) {
				await invoke("resume_routine_schedule", {
					schedule_id: schedule.scheduleId,
				});
			} else {
				await invoke("pause_routine_schedule", {
					schedule_id: schedule.scheduleId,
				});
			}
			await refreshSchedules();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setErrorMessage(message);
		} finally {
			setBusyScheduleId(null);
		}
	};

	const triggerSchedule = async (scheduleId: string) => {
		setBusyScheduleId(scheduleId);
		setErrorMessage(null);
		try {
			await invoke("trigger_routine_schedule", {
				schedule_id: scheduleId,
			});
			await refreshSchedules();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setErrorMessage(message);
		} finally {
			setBusyScheduleId(null);
		}
	};

	const deleteSchedule = async (scheduleId: string) => {
		setBusyScheduleId(scheduleId);
		setErrorMessage(null);
		try {
			await invoke("delete_routine_schedule", {
				schedule_id: scheduleId,
			});
			await refreshSchedules();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setErrorMessage(message);
		} finally {
			setBusyScheduleId(null);
		}
	};

	const openCreateDialog = async () => {
		setErrorMessage(null);
		setCreateFormError(null);
		let context: ProcessContext = { workspaceRoot: "", cwd: "" };
		try {
			context = await invoke<ProcessContext>("get_process_context");
		} catch {
			// Use empty defaults when context lookup fails.
		}
		setCreateForm({
			name: "",
			cronPattern: "0 9 * * MON-FRI",
			prompt: "Review PRs opened yesterday and summarize issues.",
			provider: "cline",
			model: "openai/gpt-5.3-codex",
			mode: "act",
			workspaceRoot: context.workspaceRoot || context.cwd,
			cwd: context.cwd || "",
			systemPrompt: "",
			maxIterations: "",
			timeoutSeconds: "",
			maxParallel: "1",
			tags: "",
			enabled: true,
		});
		setIsCreateOpen(true);
	};

	const submitCreateForm = async () => {
		const name = createForm.name.trim();
		if (!name) {
			setCreateFormError("Routine name is required.");
			return;
		}
		const cronPattern = createForm.cronPattern.trim();
		if (!cronPattern) {
			setCreateFormError("Cron pattern is required.");
			return;
		}
		const prompt = createForm.prompt.trim();
		if (!prompt) {
			setCreateFormError("Prompt is required.");
			return;
		}
		const workspaceRoot = createForm.workspaceRoot.trim();
		if (!workspaceRoot) {
			setCreateFormError("Workspace root is required.");
			return;
		}
		setCreateFormError(null);
		setIsCreating(true);
		try {
			await invoke("create_routine_schedule", {
				name,
				cron_pattern: cronPattern,
				prompt,
				provider: createForm.provider.trim() || "cline",
				model: createForm.model.trim() || "openai/gpt-5.3-codex",
				mode: createForm.mode,
				workspace_root: workspaceRoot,
				cwd: createForm.cwd.trim() || undefined,
				system_prompt: createForm.systemPrompt.trim() || undefined,
				max_iterations: parseOptionalPositiveInt(createForm.maxIterations),
				timeout_seconds: parseOptionalPositiveInt(createForm.timeoutSeconds),
				max_parallel: parseOptionalPositiveInt(createForm.maxParallel) ?? 1,
				enabled: createForm.enabled,
				tags: parseTags(createForm.tags),
			});
			await refreshSchedules();
			setIsCreateOpen(false);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setCreateFormError(message);
		} finally {
			setIsCreating(false);
		}
	};

	const executionBySchedule = useMemo(() => {
		const map = new Map<string, RoutineExecution>();
		for (const execution of activeExecutions) {
			if (!execution.scheduleId) {
				continue;
			}
			if (!map.has(execution.scheduleId)) {
				map.set(execution.scheduleId, execution);
			}
		}
		return map;
	}, [activeExecutions]);

	const sortedSchedules = useMemo(
		() =>
			[...schedules].sort((a, b) =>
				a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
			),
		[schedules],
	);

	return (
		<ScrollArea className="h-full">
			<div className="mx-auto max-w-3xl px-8 py-6">
				<div className="mb-6 flex items-center justify-between gap-3">
					<div className="flex min-w-0 items-center gap-3">
						<h2 className="truncate text-lg font-semibold text-foreground">
							Routine
						</h2>
						<span className="rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">
							RPC schedules
						</span>
					</div>
					<div className="flex items-center gap-2">
						<Button
							variant="outline"
							size="sm"
							onClick={() => void refreshSchedules()}
							disabled={isLoading}
						>
							<RefreshCw
								className={cn("h-4 w-4", isLoading && "animate-spin")}
							/>
							Refresh
						</Button>
						<Button size="sm" onClick={() => void openCreateDialog()}>
							<Plus className="h-4 w-4" />
							Add Routine
						</Button>
					</div>
				</div>

				<p className="mb-6 text-xs text-muted-foreground">
					Routines run through the RPC scheduler (same backend as
					<code className="mx-1 rounded bg-muted px-1 py-0.5">
						clite schedule
					</code>
					).
				</p>

				{errorMessage && (
					<div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
						{errorMessage}
					</div>
				)}

				{isLoading ? (
					<div className="rounded-lg border border-border px-5 py-4 text-sm text-muted-foreground">
						Loading routines...
					</div>
				) : sortedSchedules.length === 0 ? (
					<div className="rounded-lg border border-border px-5 py-4 text-sm text-muted-foreground">
						No routines configured.
					</div>
				) : (
					<div className="flex flex-col gap-3">
						{sortedSchedules.map((schedule) => {
							const isBusy = busyScheduleId === schedule.scheduleId;
							const activeExecution = executionBySchedule.get(
								schedule.scheduleId,
							);
							const upcoming = upcomingRuns.find(
								(item) => item.scheduleId === schedule.scheduleId,
							);
							return (
								<div
									key={schedule.scheduleId}
									className="rounded-lg border border-border px-5 py-4 transition-colors hover:bg-accent/20"
								>
									<div className="flex items-center gap-3">
										<Circle
											className={cn(
												"h-2.5 w-2.5 shrink-0",
												schedule.enabled
													? "fill-primary text-primary"
													: "fill-muted-foreground/40 text-muted-foreground/40",
											)}
										/>
										<h3 className="text-sm font-semibold text-foreground">
											{schedule.name}
										</h3>
										<span className="rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">
											{schedule.mode}
										</span>
										<span className="rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">
											{schedule.cronPattern}
										</span>
										<div className="flex-1" />
										<div className="flex items-center gap-1">
											<Button
												variant="ghost"
												size="icon-sm"
												aria-label={`View ${schedule.name}`}
												onClick={() => {
													window.alert(JSON.stringify(schedule, null, 2));
												}}
											>
												<Eye className="h-3.5 w-3.5" />
											</Button>
											<Button
												variant="ghost"
												size="icon-sm"
												aria-label={`Run ${schedule.name} now`}
												onClick={() =>
													void triggerSchedule(schedule.scheduleId)
												}
												disabled={isBusy}
											>
												<Zap className="h-3.5 w-3.5" />
											</Button>
											<Button
												variant="ghost"
												size="icon-sm"
												aria-label={
													schedule.enabled
														? `Pause ${schedule.name}`
														: `Resume ${schedule.name}`
												}
												onClick={() =>
													void upsertScheduleEnabled(
														schedule,
														!schedule.enabled,
													)
												}
												disabled={isBusy}
											>
												{schedule.enabled ? (
													<Pause className="h-3.5 w-3.5" />
												) : (
													<Play className="h-3.5 w-3.5" />
												)}
											</Button>
											<Button
												variant="ghost"
												size="icon-sm"
												aria-label={`Delete ${schedule.name}`}
												onClick={() => {
													if (
														window.confirm(`Delete routine "${schedule.name}"?`)
													) {
														void deleteSchedule(schedule.scheduleId);
													}
												}}
												disabled={isBusy}
											>
												<Trash2 className="h-3.5 w-3.5" />
											</Button>
											<Switch
												checked={schedule.enabled}
												onCheckedChange={(checked) =>
													void upsertScheduleEnabled(schedule, checked)
												}
												disabled={isBusy}
												aria-label={`Enable ${schedule.name}`}
											/>
										</div>
									</div>

									<div className="mt-2.5 ml-5.5 flex flex-col gap-1 text-xs text-muted-foreground">
										<p>
											<span className="text-muted-foreground/70">ID:</span>{" "}
											{schedule.scheduleId}
										</p>
										<p>
											<span className="text-muted-foreground/70">Prompt:</span>{" "}
											{schedule.prompt}
										</p>
										<p>
											<span className="text-muted-foreground/70">Model:</span>{" "}
											{schedule.provider}/{schedule.model}
										</p>
										{schedule.workspaceRoot && (
											<p>
												<span className="text-muted-foreground/70">
													Workspace:
												</span>{" "}
												{schedule.workspaceRoot}
											</p>
										)}
										{schedule.cwd && (
											<p>
												<span className="text-muted-foreground/70">CWD:</span>{" "}
												{schedule.cwd}
											</p>
										)}
										<p>
											<span className="text-muted-foreground/70">
												Last run:
											</span>{" "}
											{formatDateTime(schedule.lastRunAt)}
										</p>
										<p>
											<span className="text-muted-foreground/70">
												Next run:
											</span>{" "}
											{formatDateTime(
												schedule.nextRunAt || upcoming?.nextRunAt,
											)}
										</p>
										{activeExecution && (
											<p>
												<span className="text-muted-foreground/70">
													Active:
												</span>{" "}
												{activeExecution.executionId} since{" "}
												{formatDateTime(activeExecution.startedAt)}
											</p>
										)}
										{schedule.tags && schedule.tags.length > 0 && (
											<p>
												<span className="text-muted-foreground/70">Tags:</span>{" "}
												{schedule.tags.join(", ")}
											</p>
										)}
									</div>
								</div>
							);
						})}
					</div>
				)}
			</div>
			<Dialog
				open={isCreateOpen}
				onOpenChange={(open) => {
					setIsCreateOpen(open);
					if (!open) {
						setCreateFormError(null);
					}
				}}
			>
				<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
					<DialogHeader>
						<DialogTitle>Create Routine</DialogTitle>
						<DialogDescription>
							Create a scheduler routine. This maps directly to `clite schedule
							create`.
						</DialogDescription>
					</DialogHeader>

					<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<div className="sm:col-span-2">
							<Label htmlFor="routine-name">Name</Label>
							<Input
								id="routine-name"
								value={createForm.name}
								onChange={(event) =>
									setCreateForm((prev) => ({
										...prev,
										name: event.target.value,
									}))
								}
								placeholder="Daily code review"
							/>
						</div>

						<div className="sm:col-span-2">
							<Label htmlFor="routine-cron">Cron pattern</Label>
							<Input
								id="routine-cron"
								value={createForm.cronPattern}
								onChange={(event) =>
									setCreateForm((prev) => ({
										...prev,
										cronPattern: event.target.value,
									}))
								}
								placeholder="0 9 * * MON-FRI"
							/>
						</div>

						<div className="sm:col-span-2">
							<Label htmlFor="routine-prompt">Prompt</Label>
							<Textarea
								id="routine-prompt"
								value={createForm.prompt}
								onChange={(event) =>
									setCreateForm((prev) => ({
										...prev,
										prompt: event.target.value,
									}))
								}
								rows={4}
							/>
						</div>

						<div>
							<Label htmlFor="routine-provider">Provider</Label>
							<Input
								id="routine-provider"
								value={createForm.provider}
								onChange={(event) =>
									setCreateForm((prev) => ({
										...prev,
										provider: event.target.value,
									}))
								}
								placeholder="cline"
							/>
						</div>

						<div>
							<Label htmlFor="routine-model">Model</Label>
							<Input
								id="routine-model"
								value={createForm.model}
								onChange={(event) =>
									setCreateForm((prev) => ({
										...prev,
										model: event.target.value,
									}))
								}
								placeholder="openai/gpt-5.3-codex"
							/>
						</div>

						<div>
							<Label>Mode</Label>
							<Select
								value={createForm.mode}
								onValueChange={(value: "act" | "plan") =>
									setCreateForm((prev) => ({ ...prev, mode: value }))
								}
							>
								<SelectTrigger className="w-full">
									<SelectValue placeholder="Select mode" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="act">act</SelectItem>
									<SelectItem value="plan">plan</SelectItem>
								</SelectContent>
							</Select>
						</div>

						<div className="flex items-end gap-3 pb-1">
							<Switch
								checked={createForm.enabled}
								onCheckedChange={(checked) =>
									setCreateForm((prev) => ({ ...prev, enabled: checked }))
								}
								aria-label="Enable routine"
							/>
							<span className="text-sm text-foreground">Enabled</span>
						</div>

						<div className="sm:col-span-2">
							<Label htmlFor="routine-workspace">Workspace root</Label>
							<Input
								id="routine-workspace"
								value={createForm.workspaceRoot}
								onChange={(event) =>
									setCreateForm((prev) => ({
										...prev,
										workspaceRoot: event.target.value,
									}))
								}
							/>
						</div>

						<div className="sm:col-span-2">
							<Label htmlFor="routine-cwd">CWD (optional)</Label>
							<Input
								id="routine-cwd"
								value={createForm.cwd}
								onChange={(event) =>
									setCreateForm((prev) => ({
										...prev,
										cwd: event.target.value,
									}))
								}
							/>
						</div>

						<div className="sm:col-span-2">
							<Label htmlFor="routine-system-prompt">
								System prompt (optional)
							</Label>
							<Textarea
								id="routine-system-prompt"
								value={createForm.systemPrompt}
								onChange={(event) =>
									setCreateForm((prev) => ({
										...prev,
										systemPrompt: event.target.value,
									}))
								}
								rows={3}
							/>
						</div>

						<div>
							<Label htmlFor="routine-max-iterations">
								Max iterations (optional)
							</Label>
							<Input
								id="routine-max-iterations"
								value={createForm.maxIterations}
								onChange={(event) =>
									setCreateForm((prev) => ({
										...prev,
										maxIterations: event.target.value,
									}))
								}
								placeholder="50"
							/>
						</div>

						<div>
							<Label htmlFor="routine-timeout">
								Timeout seconds (optional)
							</Label>
							<Input
								id="routine-timeout"
								value={createForm.timeoutSeconds}
								onChange={(event) =>
									setCreateForm((prev) => ({
										...prev,
										timeoutSeconds: event.target.value,
									}))
								}
								placeholder="3600"
							/>
						</div>

						<div>
							<Label htmlFor="routine-max-parallel">Max parallel</Label>
							<Input
								id="routine-max-parallel"
								value={createForm.maxParallel}
								onChange={(event) =>
									setCreateForm((prev) => ({
										...prev,
										maxParallel: event.target.value,
									}))
								}
								placeholder="1"
							/>
						</div>

						<div>
							<Label htmlFor="routine-tags">
								Tags (comma-separated, optional)
							</Label>
							<Input
								id="routine-tags"
								value={createForm.tags}
								onChange={(event) =>
									setCreateForm((prev) => ({
										...prev,
										tags: event.target.value,
									}))
								}
								placeholder="automation,review"
							/>
						</div>
					</div>

					{createFormError && (
						<div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
							{createFormError}
						</div>
					)}

					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => setIsCreateOpen(false)}
							disabled={isCreating}
						>
							Cancel
						</Button>
						<Button
							onClick={() => void submitCreateForm()}
							disabled={isCreating}
						>
							{isCreating ? "Creating..." : "Create Routine"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</ScrollArea>
	);
}
