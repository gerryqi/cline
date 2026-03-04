"use client";

import {
	Check,
	ChevronDown,
	ChevronRight,
	FileDiff as FileDiffIcon,
	GitCommit,
	Minus,
	Plus,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { FileDiff } from "@/lib/agent-data";
import { cn } from "@/lib/utils";

interface DiffViewerDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	agentName: string;
	branch?: string;
	fileDiffs: FileDiff[];
	onCommitFile: (filePath: string) => void;
	onCommitAll: () => void;
}

function DiffHunk({ oldCode, newCode }: { oldCode: string; newCode: string }) {
	const oldLines = oldCode.split("\n").filter(Boolean);
	const newLines = newCode.split("\n").filter(Boolean);
	const oldOccurrences = new Map<string, number>();
	const oldLineEntries = oldLines.map((line, lineNumber) => {
		const occurrence = (oldOccurrences.get(line) ?? 0) + 1;
		oldOccurrences.set(line, occurrence);
		return {
			key: `old-${lineNumber + 1}-${occurrence}-${line}`,
			line,
			lineNumber: lineNumber + 1,
		};
	});
	const newOccurrences = new Map<string, number>();
	const newLineEntries = newLines.map((line, lineNumber) => {
		const occurrence = (newOccurrences.get(line) ?? 0) + 1;
		newOccurrences.set(line, occurrence);
		return {
			key: `new-${oldLines.length + lineNumber + 1}-${occurrence}-${line}`,
			line,
			lineNumber: oldLines.length + lineNumber + 1,
		};
	});

	return (
		<div className="overflow-x-auto rounded-md border border-border bg-background font-mono text-[10px] leading-5 sm:text-[11px]">
			{oldLineEntries.map((entry) => (
				<div key={entry.key} className="flex bg-destructive/10">
					<span className="hidden w-10 shrink-0 select-none items-center justify-center border-r border-border text-muted-foreground/40 sm:flex">
						{entry.lineNumber}
					</span>
					<span className="flex w-5 shrink-0 items-center justify-center text-destructive sm:w-6">
						<Minus className="h-2.5 w-2.5" />
					</span>
					<span className="min-w-0 flex-1 whitespace-pre px-1.5 text-destructive/90 sm:px-2">
						{entry.line}
					</span>
				</div>
			))}
			{newLineEntries.map((entry) => (
				<div key={entry.key} className="flex bg-success/10">
					<span className="hidden w-10 shrink-0 select-none items-center justify-center border-r border-border text-muted-foreground/40 sm:flex">
						{entry.lineNumber}
					</span>
					<span className="flex w-5 shrink-0 items-center justify-center text-success sm:w-6">
						<Plus className="h-2.5 w-2.5" />
					</span>
					<span className="min-w-0 flex-1 whitespace-pre px-1.5 text-success/90 sm:px-2">
						{entry.line}
					</span>
				</div>
			))}
		</div>
	);
}

function FileEntry({
	diff,
	onCommit,
}: {
	diff: FileDiff;
	onCommit: () => void;
}) {
	const [expanded, setExpanded] = useState(true);

	return (
		<div className="rounded-lg border border-border">
			<div className="flex flex-col gap-2 px-3 py-2 sm:flex-row sm:items-center">
				<div className="flex min-w-0 flex-1 items-center gap-2">
					<button
						type="button"
						onClick={() => setExpanded(!expanded)}
						className="shrink-0 text-muted-foreground hover:text-foreground"
					>
						{expanded ? (
							<ChevronDown className="h-3.5 w-3.5" />
						) : (
							<ChevronRight className="h-3.5 w-3.5" />
						)}
					</button>
					<FileDiffIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
					<span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
						{diff.path}
					</span>
				</div>
				<div className="flex items-center gap-2 pl-7 sm:pl-0">
					<span className="text-[10px] font-medium text-success">
						+{diff.additions}
					</span>
					<span className="text-[10px] font-medium text-destructive">
						-{diff.deletions}
					</span>
					{diff.committed ? (
						<Badge
							variant="outline"
							className="h-5 gap-1 border-success/30 px-1.5 text-[10px] text-success"
						>
							<Check className="h-2.5 w-2.5" />
							Committed
						</Badge>
					) : (
						<Button
							variant="ghost"
							size="sm"
							onClick={(e) => {
								e.stopPropagation();
								onCommit();
							}}
							className="h-6 gap-1 px-2 text-[10px] text-primary hover:bg-primary/10 hover:text-primary"
						>
							<GitCommit className="h-2.5 w-2.5" />
							Commit
						</Button>
					)}
				</div>
			</div>
			{expanded && (
				<div className="border-t border-border px-3 py-2">
					{diff.hunks.map((hunk) => (
						<DiffHunk
							key={`${hunk.old.length}-${hunk.new.length}-${hunk.old.slice(0, 24)}-${hunk.new.slice(0, 24)}`}
							oldCode={hunk.old}
							newCode={hunk.new}
						/>
					))}
				</div>
			)}
		</div>
	);
}

export function DiffViewerDialog({
	open,
	onOpenChange,
	agentName,
	branch,
	fileDiffs,
	onCommitFile,
	onCommitAll,
}: DiffViewerDialogProps) {
	const totalAdds = fileDiffs.reduce((sum, d) => sum + d.additions, 0);
	const totalDels = fileDiffs.reduce((sum, d) => sum + d.deletions, 0);
	const allCommitted =
		fileDiffs.length > 0 && fileDiffs.every((d) => d.committed);
	const uncommittedCount = fileDiffs.filter((d) => !d.committed).length;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[95dvh] border-border bg-card max-sm:h-[95dvh] max-sm:max-w-[95vw] sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2 text-foreground">
						<FileDiffIcon className="h-4 w-4 text-primary" />
						{agentName} - File Changes
					</DialogTitle>
					<DialogDescription className="flex flex-wrap items-center gap-2 text-muted-foreground sm:gap-3">
						{branch && (
							<span className="truncate font-mono text-xs">{branch}</span>
						)}
						<span className="text-xs">
							{fileDiffs.length} {fileDiffs.length === 1 ? "file" : "files"}{" "}
							changed
						</span>
						<span className="text-xs text-success">+{totalAdds}</span>
						<span className="text-xs text-destructive">-{totalDels}</span>
					</DialogDescription>
				</DialogHeader>

				<ScrollArea className="max-h-[60vh]">
					<div className="flex flex-col gap-3 pr-4">
						{fileDiffs.length === 0 ? (
							<div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
								<FileDiffIcon className="mb-2 h-8 w-8 text-muted-foreground/30" />
								<p className="text-sm">No file changes yet</p>
							</div>
						) : (
							fileDiffs.map((diff) => (
								<FileEntry
									key={diff.path}
									diff={diff}
									onCommit={() => onCommitFile(diff.path)}
								/>
							))
						)}
					</div>
				</ScrollArea>

				{fileDiffs.length > 0 && (
					<div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
						<span className="text-xs text-muted-foreground">
							{uncommittedCount > 0
								? `${uncommittedCount} uncommitted ${uncommittedCount === 1 ? "file" : "files"}`
								: "All files committed"}
						</span>
						<Button
							size="sm"
							disabled={allCommitted}
							onClick={onCommitAll}
							className={cn(
								"gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90",
								allCommitted && "opacity-50",
							)}
						>
							<GitCommit className="h-3.5 w-3.5" />
							Commit All
						</Button>
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
}
