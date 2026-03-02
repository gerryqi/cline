"use client";

import {
	Activity,
	Bot,
	ChevronLeft,
	RefreshCw,
	Search,
	Trash2,
} from "lucide-react";
import Link from "next/link";
import { NewAgentDialog } from "@/components/new-agent-dialog";
import { Button } from "@/components/ui/button";

interface BoardHeaderProps {
	agentCounts: {
		queued: number;
		running: number;
		completed: number;
		failed: number;
	};
	searchQuery: string;
	onSearchChange: (query: string) => void;
	onRefresh: () => void;
	onDeleteTerminalAgents: () => void;
	isRefreshing?: boolean;
	onCreateAgent: (data: {
		name: string;
		type: string;
		model: string;
		provider: string;
		branch: string;
		taskNames: string[];
		workspaceRoot: string;
		cwd: string;
		teamName: string;
		enableTools: boolean;
		enableSpawn: boolean;
		enableTeams: boolean;
		autoApproveTools?: boolean;
		prompt: string;
		apiKey?: string;
		systemPrompt?: string;
		maxIterations?: number;
	}) => void;
	defaultWorkspaceRoot: string;
	defaultCwd: string;
}

export function BoardHeader({
	agentCounts,
	searchQuery,
	onSearchChange,
	onRefresh,
	onDeleteTerminalAgents,
	isRefreshing = false,
	onCreateAgent,
	defaultWorkspaceRoot,
	defaultCwd,
}: BoardHeaderProps) {
	const totalAgents =
		agentCounts.queued +
		agentCounts.running +
		agentCounts.completed +
		agentCounts.failed;
	const terminalAgentCount = agentCounts.completed + agentCounts.failed;

	return (
		<header className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:px-6 sm:py-4 md:gap-4">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-3">
					<Link
						aria-label="Back to home"
						className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground sm:h-9 sm:w-9"
						href="/"
					>
						<ChevronLeft className="h-4 w-4" />
					</Link>
					<div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 sm:h-9 sm:w-9">
						<Bot className="h-4 w-4 text-primary sm:h-5 sm:w-5" />
					</div>
					<div>
						<h1 className="text-base font-semibold text-foreground sm:text-lg">
							Cline Kanban
						</h1>
						<p className="text-[10px] text-muted-foreground sm:text-xs">
							{totalAgents} agents tracked
						</p>
					</div>
				</div>

				{/* Right side actions - always visible */}
				<div className="flex items-center gap-2">
					<NewAgentDialog
						defaultCwd={defaultCwd}
						defaultWorkspaceRoot={defaultWorkspaceRoot}
						onCreateAgent={onCreateAgent}
					/>

					<Button
						className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
						disabled={isRefreshing}
						onClick={onRefresh}
						size="sm"
						variant="ghost"
					>
						<RefreshCw
							className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`}
						/>
						<span className="sr-only">Refresh agents</span>
					</Button>
					{totalAgents > 0 && (
						<Button
							className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
							disabled={terminalAgentCount === 0}
							onClick={onDeleteTerminalAgents}
							size="sm"
							variant="ghost"
						>
							<Trash2 className="h-3.5 w-3.5" />
							<span className="sr-only">
								Delete completed and failed agents
							</span>
						</Button>
					)}

					<div className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
						<Activity className="h-3 w-3 text-success" />
						<span>Live</span>
					</div>
				</div>
			</div>

			{/* Bottom row: status counters + search */}
			<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
				<div className="flex items-center gap-2 overflow-x-auto rounded-lg border border-border bg-card px-3 py-1.5">
					<div className="flex items-center gap-1.5">
						<span className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground" />
						<span className="text-xs text-muted-foreground">
							{agentCounts.queued}
						</span>
					</div>
					<div className="flex items-center gap-1.5">
						<span className="h-2 w-2 shrink-0 animate-pulse-dot rounded-full bg-primary" />
						<span className="text-xs text-muted-foreground">
							{agentCounts.running}
						</span>
					</div>
					<div className="flex items-center gap-1.5">
						<span className="h-2 w-2 shrink-0 rounded-full bg-success" />
						<span className="text-xs text-muted-foreground">
							{agentCounts.completed}
						</span>
					</div>
					<div className="flex items-center gap-1.5">
						<span className="h-2 w-2 shrink-0 rounded-full bg-destructive" />
						<span className="text-xs text-muted-foreground">
							{agentCounts.failed}
						</span>
					</div>
				</div>

				<div className="relative">
					<Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
					<input
						className="h-8 w-full rounded-lg border border-border bg-card pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary sm:w-48"
						onChange={(e) => onSearchChange(e.target.value)}
						placeholder="Filter agents..."
						type="text"
						value={searchQuery}
					/>
				</div>
			</div>
		</header>
	);
}
