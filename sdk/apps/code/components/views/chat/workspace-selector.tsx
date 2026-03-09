"use client";

import { Check, ChevronDown, GitBranch, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function formatWorkspacePath(path: string): string {
	const unixHome = path.match(/^\/Users\/[^/]+\/(.*)$/);
	if (unixHome) return unixHome[1] ? `~/${unixHome[1]}` : "~";
	const linuxHome = path.match(/^\/home\/[^/]+\/(.*)$/);
	if (linuxHome) return linuxHome[1] ? `~/${linuxHome[1]}` : "~";
	const windowsHome = path.match(/^[A-Za-z]:\\Users\\[^\\]+\\(.*)$/);
	if (windowsHome) {
		const tail = windowsHome[1]?.replaceAll("\\", "/") || "";
		return tail ? `~/${tail}` : "~";
	}
	return path;
}

export function GitBranchSelector({
	currentBranch,
	workspaceRoot,
	onListGitBranches,
	onListWorkspaces,
	onSwitchGitBranch,
	onSwitchWorkspace,
}: {
	currentBranch: string;
	workspaceRoot: string;
	onListGitBranches: () => Promise<{ current: string; branches: string[] }>;
	onListWorkspaces: () => Promise<string[]>;
	onSwitchGitBranch: (branch: string) => Promise<boolean>;
	onSwitchWorkspace: (workspacePath: string) => Promise<boolean>;
}) {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const [branches, setBranches] = useState<string[]>([]);
	const [workspaces, setWorkspaces] = useState<string[]>([]);
	const [loadingBranches, setLoadingBranches] = useState(false);
	const [switching, setSwitching] = useState(false);
	const [switchingWorkspace, setSwitchingWorkspace] = useState(false);

	const workspaceName = useMemo(() => {
		const trimmed = workspaceRoot.trim().replace(/[\\/]+$/, "");
		if (!trimmed) {
			return "workspace";
		}
		const parts = trimmed.split(/[\\/]/);
		return parts[parts.length - 1] || "workspace";
	}, [workspaceRoot]);

	// Preload workspaces on mount so the dropdown is instant
	useEffect(() => {
		let cancelled = false;
		onListWorkspaces()
			.then((results) => {
				if (!cancelled) setWorkspaces(results);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [onListWorkspaces]);

	const openMenu = async () => {
		setOpen(true);
		setSearch("");
		setLoadingBranches(true);
		try {
			const branchPayload = await onListGitBranches();
			setBranches(branchPayload.branches);
		} finally {
			setLoadingBranches(false);
		}
	};

	const handleSelectBranch = async (branch: string) => {
		if (branch === currentBranch || switching) {
			setOpen(false);
			setSearch("");
			return;
		}
		setSwitching(true);
		const switched = await onSwitchGitBranch(branch);
		setSwitching(false);
		if (switched) {
			setOpen(false);
			setSearch("");
		}
	};

	const handleWorkspaceSelect = async (nextWorkspacePath: string) => {
		const next = nextWorkspacePath.trim();
		if (!next || next === workspaceRoot || switchingWorkspace) {
			return;
		}
		setSwitchingWorkspace(true);
		const switched = await onSwitchWorkspace(next);
		setSwitchingWorkspace(false);
		if (switched) {
			setOpen(false);
			setSearch("");
		}
	};

	const handleSwitchWorkspacePath = () => {
		const proposed = window.prompt("Enter workspace path", workspaceRoot);
		if (!proposed?.trim()) return;
		void handleWorkspaceSelect(proposed.trim());
	};

	const filteredBranches = branches.filter((b) =>
		b.toLowerCase().includes(search.toLowerCase()),
	);

	const filteredWorkspaces = workspaces.filter((w) =>
		w.toLowerCase().includes(search.toLowerCase()),
	);

	return (
		<div className="relative">
			<button
				className="flex items-center gap-1 hover:text-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-60"
				disabled={switching}
				id="git-branch-btn"
				onClick={() => {
					if (open) {
						setOpen(false);
						setSearch("");
						return;
					}
					void openMenu();
				}}
				type="button"
			>
				<GitBranch className="h-3 w-3" />
				<span className="max-w-20 truncate">{workspaceName}</span>
				<span className="text-muted-foreground/60">/</span>
				<span className="max-w-20 truncate">{currentBranch}</span>
				<ChevronDown className="h-2.5 w-2.5" />
			</button>

			{open && (
				<>
					<Button
						className="fixed inset-0 z-40"
						onClick={() => {
							setOpen(false);
							setSearch("");
						}}
						variant="ghost"
					/>
					<div className="absolute bottom-full right-0 z-50 mb-2 w-72 rounded-lg border border-border bg-popover shadow-xl">
						{/* Search */}
						<div className="p-2 border-b border-border">
							<div className="flex items-center gap-2 rounded-md bg-background px-2.5 py-1.5">
								<Search className="size-3 text-muted-foreground" />
								<Input
									autoFocus={false}
									value={search}
									onChange={(e) => setSearch(e.target.value)}
									placeholder="Search workspaces & branches"
									className="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground outline-none"
								/>
							</div>
						</div>

						{loadingBranches ? (
							<div className="px-3 py-4 text-xs text-muted-foreground">
								Loading...
							</div>
						) : (
							<>
								{/* Workspaces section */}
								<div className="p-1.5 border-b border-border">
									<div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
										Workspaces
									</div>
									<div className="flex flex-col gap-0.5 max-h-28 overflow-y-auto">
										{filteredWorkspaces.length === 0 ? (
											<div className="px-2 py-2 text-xs text-muted-foreground">
												No workspaces found
											</div>
										) : (
											filteredWorkspaces.map((wp) => (
												<Button
													variant="ghost"
													key={wp}
													disabled={switchingWorkspace}
													onClick={() => {
														void handleWorkspaceSelect(wp);
													}}
													className={cn(
														"flex items-center justify-between rounded-md px-2 py-2 text-left transition-colors",
														wp === workspaceRoot
															? "bg-accent"
															: "hover:bg-accent/50",
													)}
												>
													<span className="text-xs text-foreground truncate">
														{formatWorkspacePath(wp)}
													</span>
													{wp === workspaceRoot && (
														<Check className="h-3 w-3 text-foreground shrink-0 ml-2" />
													)}
												</Button>
											))
										)}
									</div>
									<Button
										variant="ghost"
										onClick={handleSwitchWorkspacePath}
										disabled={switchingWorkspace}
										className="justify-start w-full mt-2"
										size="sm"
									>
										Switch workspace path...
									</Button>
								</div>

								{/* Branches section */}
								<div className="p-1.5">
									<div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
										Branches
									</div>
									<div className="flex flex-col gap-0.5 max-h-36 overflow-y-auto">
										{filteredBranches.length === 0 ? (
											<div className="px-2 py-2 text-xs text-muted-foreground">
												No branches found
											</div>
										) : (
											filteredBranches.map((branch) => (
												<Button
													variant="ghost"
													key={branch}
													disabled={switching}
													onClick={() => {
														void handleSelectBranch(branch);
													}}
													className={cn(
														"flex items-center gap-2 rounded-md px-2 py-2 text-left transition-colors",
														currentBranch === branch
															? "bg-accent"
															: "hover:bg-accent/50",
													)}
												>
													<GitBranch className="size-3 shrink-0 text-muted-foreground" />
													<span className="text-xs font-medium text-foreground truncate flex-1">
														{branch}
													</span>
													{currentBranch === branch && (
														<Check className="h-3 w-3 text-foreground shrink-0 ml-auto" />
													)}
												</Button>
											))
										)}
										<Button
											variant="ghost"
											onClick={handleSwitchWorkspacePath}
											disabled={switchingWorkspace}
											className="justify-start w-full"
											size="sm"
										>
											Switch branch...
										</Button>
									</div>
								</div>
							</>
						)}
					</div>
				</>
			)}
		</div>
	);
}
