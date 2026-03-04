"use client";

import { MoreHorizontal, Plus, Trash2 } from "lucide-react";
import type { ChatSessionStatus } from "@/lib/chat-schema";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { normalizeTitle } from "./utils";

type AgentHeaderProps = {
	title?: string;
	onNewThread?: () => void;
	onDeleteSession?: () => void;
	canDeleteSession?: boolean;
	deletingSession?: boolean;
	onOpenDiff?: () => void;
	status?: ChatSessionStatus;
	diff?: {
		additions: number;
		deletions: number;
	};
};

export function AgentHeader({
	title,
	onNewThread,
	onDeleteSession,
	canDeleteSession,
	deletingSession,
	onOpenDiff,
	status,
	diff,
}: AgentHeaderProps) {
	const additions = diff?.additions ?? 0;
	const deletions = diff?.deletions ?? 0;
	const hasChanges = additions + deletions > 0;
	const threadTitle = normalizeTitle(title?.trim()) || "New Session";

	return (
		<header className="flex h-12 items-center justify-between border-b border-border bg-card px-4">
			{/* Left: thread title */}
			<div className="flex items-center gap-2">
				<span
					className={cn(
						"rounded w-2 h-2 font-mono",
						status === "running"
							? "bg-green-500"
							: status === "failed"
								? "bg-red-500"
								: "bg-gray-500",
					)}
				/>
				<h1 className="text-sm font-medium text-foreground">{threadTitle}</h1>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							className="text-muted-foreground hover:text-foreground transition-colors"
							id="show-more-btn"
							variant="ghost"
							size="icon-sm"
							type="button"
						>
							<MoreHorizontal className="size-3" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="start" className="w-44">
						<DropdownMenuItem
							className="text-destructive focus:text-destructive"
							disabled={!canDeleteSession || deletingSession}
							onClick={() => onDeleteSession?.()}
						>
							<Trash2 className="size-4" />
							<span>{deletingSession ? "Deleting..." : "Delete session"}</span>
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>

			{/* Right: actions */}
			<div className="flex items-center gap-2">
				{/* DIFF */}
				<Button
					className={cn(
						"flex items-center gap-1 rounded-md bg-secondary px-2 py-1 text-xs font-mono transition-colors",
						hasChanges ? "hover:bg-secondary/80" : "cursor-default opacity-60",
					)}
					disabled={!hasChanges}
					id="diff-stats"
					onClick={() => onOpenDiff?.()}
					size="sm"
					type="button"
					variant="secondary"
				>
					<span className="text-primary">+{additions}</span>
					<span className="text-destructive">-{deletions}</span>
				</Button>
				{/* New Chat Button */}
				<Button
					className="flex items-center gap-1 rounded-md text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
					onClick={() => onNewThread?.()}
					size="icon-sm"
					variant="ghost"
				>
					<Plus />
				</Button>
			</div>
		</header>
	);
}
