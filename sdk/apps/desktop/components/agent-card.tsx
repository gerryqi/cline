"use client";

import {
	AlertTriangle,
	Ban,
	CheckCircle2,
	ChevronDown,
	ChevronUp,
	Circle,
	Clock,
	Cpu,
	FileCode,
	FileDiff,
	Folder,
	GitBranch,
	GitCommit,
	Loader2,
	Play,
	Square,
	Terminal,
	Trash2,
	Zap,
} from "lucide-react";
import { useState } from "react";
import { DiffViewerDialog } from "@/components/diff-viewer-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { Agent, AgentStatus, AgentTask } from "@/lib/agent-data";
import { cn } from "@/lib/utils";

function StatusIcon({ status }: { status: AgentStatus }) {
	switch (status) {
		case "queued":
			return <Circle className="h-3 w-3 text-muted-foreground" />;
		case "running":
			return <Loader2 className="h-3 w-3 animate-spin text-primary" />;
		case "completed":
			return <CheckCircle2 className="h-3 w-3 text-success" />;
		case "failed":
			return <AlertTriangle className="h-3 w-3 text-destructive" />;
		case "cancelled":
			return <Ban className="h-3 w-3 text-warning" />;
	}
}

function TaskRow({ task }: { task: AgentTask }) {
	return (
		<div className="flex items-center gap-2 py-1">
			<StatusIcon status={task.status} />
			<span
				className={cn(
					"flex-1 text-xs",
					task.status === "completed"
						? "text-muted-foreground line-through"
						: "text-foreground",
					task.status === "cancelled" && "text-muted-foreground",
				)}
			>
				{task.name}
			</span>
			{task.file && (
				<span className="hidden max-w-[120px] truncate font-mono text-[10px] text-muted-foreground sm:block">
					{task.file}
				</span>
			)}
			{task.status === "running" && (
				<span className="text-[10px] font-medium text-primary">
					{task.progress}%
				</span>
			)}
		</div>
	);
}

function statusColor(status: AgentStatus): string {
	switch (status) {
		case "queued":
			return "bg-muted-foreground";
		case "running":
			return "bg-primary";
		case "completed":
			return "bg-success";
		case "failed":
			return "bg-destructive";
		case "cancelled":
			return "bg-warning";
	}
}

function progressBarColor(status: AgentStatus): string {
	switch (status) {
		case "queued":
			return "[&>div]:bg-muted-foreground";
		case "running":
			return "[&>div]:bg-primary";
		case "completed":
			return "[&>div]:bg-success";
		case "failed":
			return "[&>div]:bg-destructive";
		case "cancelled":
			return "[&>div]:bg-warning";
	}
}

function formatWorkspaceRoot(path: string): string {
	if (!path) {
		return path;
	}
	const macosHome = path.match(/^\/Users\/[^/]+(\/.*)?$/);
	if (macosHome) {
		return `~${macosHome[1] ?? ""}`;
	}
	const linuxHome = path.match(/^\/home\/[^/]+(\/.*)?$/);
	if (linuxHome) {
		return `~${linuxHome[1] ?? ""}`;
	}
	return path;
}

interface AgentCardProps {
	agent: Agent;
	onStartAgent?: (id: string) => void;
	onStopAgent?: (id: string) => void;
	onCommitFile?: (agentId: string, filePath: string) => void;
	onCommitAll?: (agentId: string) => void;
	onDeleteAgent?: (id: string) => void;
}

export function AgentCard({
	agent,
	onStartAgent,
	onStopAgent,
	onCommitFile,
	onCommitAll,
	onDeleteAgent,
}: AgentCardProps) {
	const [expanded, setExpanded] = useState(false);
	const [diffOpen, setDiffOpen] = useState(false);

	const uncommittedFiles = agent.fileDiffs.filter((d) => !d.committed).length;
	const totalFileDiffs = agent.fileDiffs.length;

	return (
		<>
			<div
				className={cn(
					"group rounded-lg border bg-card transition-all hover:border-primary/30",
					agent.status === "running" && "border-primary/20",
					agent.status === "failed" && "border-destructive/20",
					agent.status === "cancelled" && "border-warning/20",
				)}
			>
				{/* Collapsed header */}
				<button
					aria-expanded={expanded}
					className="w-full p-3 text-left"
					onClick={() => setExpanded(!expanded)}
					type="button"
				>
					<div className="flex items-start justify-between gap-2">
						<div className="flex items-center gap-2">
							<span
								className={cn(
									"h-2 w-2 rounded-full",
									statusColor(agent.status),
									agent.status === "running" && "animate-pulse-dot",
								)}
							/>
							<span className="text-sm font-medium text-foreground">
								{agent.name}
							</span>
						</div>
						{expanded ? (
							<ChevronUp className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
						) : (
							<ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
						)}
					</div>

					<div className="mt-1.5 flex items-center gap-2">
						<Badge
							className="h-5 border-border px-1.5 text-[10px] text-muted-foreground"
							variant="outline"
						>
							{agent.type}
						</Badge>
						<span className="font-mono text-[10px] text-muted-foreground">
							{agent.model}
						</span>
						{totalFileDiffs > 0 && (
							<span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground">
								<FileCode className="h-3 w-3" />
								{totalFileDiffs}
							</span>
						)}
					</div>

					{(agent.status === "running" ||
						agent.status === "failed" ||
						agent.status === "cancelled") && (
						<div className="mt-2.5 flex items-center gap-2">
							<Progress
								className={cn(
									"h-1 flex-1 bg-muted",
									progressBarColor(agent.status),
								)}
								value={agent.progress}
							/>
							<span className="text-[10px] font-medium text-muted-foreground">
								{agent.progress}%
							</span>
						</div>
					)}

					{agent.currentFile && agent.status === "running" && (
						<div className="mt-2 flex items-center gap-1.5">
							<FileCode className="h-3 w-3 text-muted-foreground" />
							<span className="truncate font-mono text-[10px] text-muted-foreground">
								{agent.currentFile}
							</span>
						</div>
					)}
				</button>

				{/* Action buttons area (always visible) */}
				{(agent.status === "queued" || agent.status === "running") && (
					<div className="flex items-center gap-2 border-t border-border px-3 py-2">
						{agent.status === "queued" && onStartAgent && (
							<Button
								className="h-7 gap-1.5 px-2.5 text-[11px] text-success hover:bg-success/10 hover:text-success"
								onClick={(e) => {
									e.stopPropagation();
									onStartAgent(agent.id);
								}}
								size="sm"
								variant="ghost"
							>
								<Play className="h-3 w-3" />
								Start
							</Button>
						)}
						{agent.status === "running" && onStopAgent && (
							<Button
								className="h-7 gap-1.5 px-2.5 text-[11px] text-warning hover:bg-warning/10 hover:text-warning"
								onClick={(e) => {
									e.stopPropagation();
									onStopAgent(agent.id);
								}}
								size="sm"
								variant="ghost"
							>
								<Square className="h-3 w-3" />
								Stop
							</Button>
						)}
						{totalFileDiffs > 0 && (
							<Button
								className="ml-auto h-7 gap-1.5 px-2.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
								onClick={(e) => {
									e.stopPropagation();
									setDiffOpen(true);
								}}
								size="sm"
								variant="ghost"
							>
								<FileDiff className="h-3 w-3" />
								{uncommittedFiles > 0
									? `${uncommittedFiles} uncommitted`
									: "View diffs"}
							</Button>
						)}
					</div>
				)}

				{/* Completed/failed/cancelled bottom actions for diffs */}
				{(agent.status === "completed" ||
					agent.status === "failed" ||
					agent.status === "cancelled") &&
					totalFileDiffs + uncommittedFiles > 0 && (
						<div className="flex items-center gap-2 border-t border-border px-3 py-2">
							{totalFileDiffs > 0 && (
								<Button
									className="h-7 gap-1.5 px-2.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
									onClick={(e) => {
										e.stopPropagation();
										setDiffOpen(true);
									}}
									size="sm"
									variant="ghost"
								>
									<FileDiff className="h-3 w-3" />
									View {totalFileDiffs}{" "}
									{totalFileDiffs === 1 ? "file" : "files"}
									{uncommittedFiles > 0 && (
										<Badge className="ml-1 h-4 bg-primary/20 px-1 text-[9px] text-primary">
											{uncommittedFiles} uncommitted
										</Badge>
									)}
								</Button>
							)}
							{uncommittedFiles > 0 && onCommitAll && (
								<Button
									className="ml-auto h-7 gap-1.5 px-2.5 text-[11px] text-primary hover:bg-primary/10 hover:text-primary"
									onClick={(e) => {
										e.stopPropagation();
										onCommitAll(agent.id);
									}}
									size="sm"
									variant="ghost"
								>
									<GitCommit className="h-3 w-3" />
									Commit All
								</Button>
							)}
						</div>
					)}

				{/* Expanded details */}
				{expanded && (
					<div className="border-t border-border px-3 pb-3 pt-2">
						{/* Meta info */}
						<div className="grid grid-cols-1 gap-x-4 gap-y-1.5 pb-2.5 sm:grid-cols-2">
							<div className="flex items-center gap-1.5">
								<Clock className="h-3 w-3 text-muted-foreground" />
								<span className="text-[10px] text-muted-foreground">
									{agent.startedAt}
								</span>
							</div>
							<div className="flex items-center gap-1.5">
								<Zap className="h-3 w-3 text-warning" />
								<span className="text-[10px] text-muted-foreground">
									{agent.tokensUsed.toLocaleString()} tokens
								</span>
							</div>
							<div className="flex items-center gap-1.5">
								<FileCode className="h-3 w-3 text-muted-foreground" />
								<span className="text-[10px] text-muted-foreground">
									{agent.filesModified} files modified
								</span>
							</div>
							<div className="flex items-center gap-1.5">
								<Folder className="h-3 w-3 text-muted-foreground" />
								<span className="truncate font-mono text-[10px] text-muted-foreground">
									{formatWorkspaceRoot(agent.workspaceRoot)}
								</span>
							</div>
							{agent.branch && (
								<div className="flex items-center gap-1.5">
									<GitBranch className="h-3 w-3 text-muted-foreground" />
									<span className="truncate font-mono text-[10px] text-muted-foreground">
										{agent.branch}
									</span>
								</div>
							)}
						</div>

						{/* File changes summary */}
						{totalFileDiffs > 0 && (
							<div className="border-t border-border pb-2.5 pt-2.5">
								<div className="mb-1.5 flex items-center gap-1.5">
									<FileDiff className="h-3 w-3 text-muted-foreground" />
									<span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
										Changed Files
									</span>
								</div>
								<div className="flex flex-col gap-1">
									{agent.fileDiffs.slice(0, 4).map((diff) => (
										<div className="flex items-center gap-2" key={diff.path}>
											<span
												className={cn(
													"h-1.5 w-1.5 rounded-full",
													diff.committed ? "bg-success" : "bg-muted-foreground",
												)}
											/>
											<span className="flex-1 truncate font-mono text-[10px] text-muted-foreground">
												{diff.path}
											</span>
											<span className="text-[10px] text-success">
												+{diff.additions}
											</span>
											<span className="text-[10px] text-destructive">
												-{diff.deletions}
											</span>
										</div>
									))}
									{agent.fileDiffs.length > 4 && (
										<button
											className="mt-0.5 text-left text-[10px] text-primary hover:text-primary/80"
											onClick={(e) => {
												e.stopPropagation();
												setDiffOpen(true);
											}}
											type="button"
										>
											+{agent.fileDiffs.length - 4} more files...
										</button>
									)}
								</div>
							</div>
						)}

						{/* Tasks */}
						<div className="border-t border-border pt-2.5">
							<div className="mb-1.5 flex items-center gap-1.5">
								<Cpu className="h-3 w-3 text-muted-foreground" />
								<span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
									Tasks
								</span>
							</div>
							<div className="flex flex-col">
								{agent.tasks.map((task) => (
									<TaskRow key={task.id} task={task} />
								))}
							</div>
						</div>

						{/* Logs */}
						<div className="mt-2.5 border-t border-border pt-2.5">
							<div className="mb-1.5 flex items-center gap-1.5">
								<Terminal className="h-3 w-3 text-muted-foreground" />
								<span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
									Logs
								</span>
							</div>
							<div className="max-h-24 overflow-y-auto rounded-md bg-background p-2">
								{agent.logs.map((log) => (
									<p
										className={cn(
											"font-mono text-[10px] leading-relaxed",
											log.startsWith("ERROR") || log.startsWith("FATAL")
												? "text-destructive"
												: log.startsWith("CANCELLED")
													? "text-warning"
													: "text-muted-foreground",
										)}
										key={log}
									>
										<span className="text-muted-foreground/50">{">"}</span>{" "}
										{log}
									</p>
								))}
							</div>
						</div>
						<div className="items-end flex w-full mt-1">
							{agent.status === "completed" && onDeleteAgent && (
								<Button
									className={cn(
										"h-7 gap-1.5 px-1 text-[11px]",
										uncommittedFiles === 0 && "ml-auto",
									)}
									onClick={(e) => {
										e.stopPropagation();
										onDeleteAgent(agent.id);
									}}
									size="sm"
									variant="ghost"
								>
									<Trash2 className="h-3 w-3" />
								</Button>
							)}
						</div>
					</div>
				)}
			</div>

			{/* Diff viewer dialog */}
			<DiffViewerDialog
				agentName={agent.name}
				branch={agent.branch}
				fileDiffs={agent.fileDiffs}
				onCommitAll={() => onCommitAll?.(agent.id)}
				onCommitFile={(filePath) => onCommitFile?.(agent.id, filePath)}
				onOpenChange={setDiffOpen}
				open={diffOpen}
			/>
		</>
	);
}
