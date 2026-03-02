"use client";

import { AgentCard } from "@/components/agent-card";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Agent, AgentStatus } from "@/lib/agent-data";
import { cn } from "@/lib/utils";

interface KanbanColumnProps {
	status: AgentStatus;
	label: string;
	agents: Agent[];
	onStartAgent?: (id: string) => void;
	onStopAgent?: (id: string) => void;
	onCommitFile?: (agentId: string, filePath: string) => void;
	onCommitAll?: (agentId: string) => void;
	onDeleteAgent?: (id: string) => void;
}

function columnAccentColor(status: AgentStatus): string {
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

function columnBgClass(status: AgentStatus): string {
	switch (status) {
		case "queued":
			return "bg-muted/30";
		case "running":
			return "bg-primary/[0.03]";
		case "completed":
			return "bg-success/[0.03]";
		case "failed":
			return "bg-destructive/[0.03]";
		case "cancelled":
			return "bg-warning/[0.03]";
	}
}

export function KanbanColumn({
	status,
	label,
	agents,
	onStartAgent,
	onStopAgent,
	onCommitFile,
	onCommitAll,
	onDeleteAgent,
}: KanbanColumnProps) {
	return (
		<div
			className={cn(
				"flex w-full flex-1 flex-col rounded-xl border border-border md:min-w-[260px] lg:min-w-[280px]",
				columnBgClass(status),
			)}
		>
			{/* Column Header */}
			<div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
				<span
					className={cn(
						"h-2.5 w-2.5 rounded-full",
						columnAccentColor(status),
						status === "running" && "animate-pulse-dot",
					)}
				/>
				<h2 className="text-sm font-medium text-foreground">{label}</h2>
				<span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-md bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">
					{agents.length}
				</span>
			</div>

			{/* Cards */}
			<ScrollArea className="flex-1">
				<div className="flex flex-col gap-2 p-3">
					{agents.length === 0 ? (
						<div className="flex flex-col items-center justify-center py-12 text-center">
							<div className="text-xs text-muted-foreground/60">No agents</div>
						</div>
					) : (
						agents.map((agent) => (
							<AgentCard
								key={agent.id}
								agent={agent}
								onStartAgent={onStartAgent}
								onStopAgent={onStopAgent}
								onCommitFile={onCommitFile}
								onCommitAll={onCommitAll}
								onDeleteAgent={onDeleteAgent}
							/>
						))
					)}
				</div>
			</ScrollArea>
		</div>
	);
}
