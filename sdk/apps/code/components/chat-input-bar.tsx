"use client";

import { invoke } from "@tauri-apps/api/core";
import {
	ArrowUp,
	ChevronDown,
	CircleStop,
	Coins,
	GitBranch,
	Mic,
	Paperclip,
	RotateCcw,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	Combobox,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
} from "@/components/ui/combobox";
import { useWorkspace } from "@/contexts/workspace-context";
import type { ChatSessionStatus } from "@/lib/chat-schema";
import {
	readModelSelectionStorageFromWindow,
	writeModelSelectionStorageToWindow,
} from "@/lib/model-selection";
import { cn } from "@/lib/utils";

type ActiveMention = {
	start: number;
	end: number;
	query: string;
};

const FALLBACK_PROVIDER_MODELS: Record<string, string[]> = {
	cline: ["anthropic/claude-sonnet-4.6"],
	anthropic: ["claude-sonnet-4-6"],
	openai: ["gpt-5.3-codex"],
	openrouter: ["anthropic/claude-sonnet-4.6"],
	gemini: ["gemini-2.5-pro"],
};

const FALLBACK_PROVIDER_REASONING_MODELS: Record<string, string[]> = {
	cline: ["anthropic/claude-sonnet-4.6"],
	anthropic: ["claude-sonnet-4-6"],
	openai: ["gpt-5.3-codex"],
	openrouter: ["anthropic/claude-sonnet-4.6"],
	gemini: ["gemini-2.5-pro"],
};

function hasReasoningCapability(
	providerReasoningModels: Record<string, string[]>,
	provider: string,
	model: string,
): boolean {
	return (providerReasoningModels[provider] ?? []).includes(model);
}

function getActiveMention(input: string, cursor: number): ActiveMention | null {
	if (cursor < 0 || cursor > input.length) {
		return null;
	}
	const left = input.slice(0, cursor);
	const atIndex = left.lastIndexOf("@");
	if (atIndex === -1) {
		return null;
	}
	const before = atIndex === 0 ? "" : left[atIndex - 1];
	if (before && !/\s/.test(before)) {
		return null;
	}
	const mentionBody = left.slice(atIndex + 1);
	if (!/^[^\s@]*$/.test(mentionBody)) {
		return null;
	}
	return {
		start: atIndex,
		end: cursor,
		query: mentionBody,
	};
}

type ChatInputBarProps = {
	status: ChatSessionStatus;
	provider: string;
	model: string;
	mode: "act" | "plan";
	gitBranch: string;
	promptInput: string;
	onPromptInputChange: (value: string) => void;
	onProviderChange: (provider: string) => void;
	onModelChange: (model: string) => void;
	onModeToggle: () => void;
	onRefreshGitBranch: () => void;
	onListGitBranches: () => Promise<{ current: string; branches: string[] }>;
	onSwitchGitBranch: (branch: string) => Promise<boolean>;
	onSend: () => void;
	onAbort: () => void;
	onReset: () => void;
	attachments: Array<{ id: string; name: string; isImage: boolean }>;
	onAttachFiles: (files: File[]) => void;
	onRemoveAttachment: (id: string) => void;
	summary: {
		toolCalls: number;
		tokensIn: number;
		tokensOut: number;
	};
};

export function ChatInputBar({
	status,
	provider,
	model,
	mode,
	gitBranch,
	promptInput,
	onPromptInputChange,
	onProviderChange,
	onModelChange,
	onModeToggle,
	onRefreshGitBranch,
	onListGitBranches,
	onSwitchGitBranch,
	onSend,
	onAbort,
	onReset,
	attachments,
	onAttachFiles,
	onRemoveAttachment,
	summary,
}: ChatInputBarProps) {
	const {
		workspaceRoot,
		listWorkspaces: onListWorkspaces,
		switchWorkspace: onSwitchWorkspace,
	} = useWorkspace();
	const isBusy =
		status === "starting" || status === "running" || status === "stopping";
	const canAbort = isBusy;
	const [modelSupportsReasoning, setModelSupportsReasoning] = useState(() =>
		hasReasoningCapability(FALLBACK_PROVIDER_REASONING_MODELS, provider, model),
	);
	const canSend =
		(promptInput.trim().length > 0 || attachments.length > 0) && !isBusy;
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const promptInputRef = useRef<HTMLInputElement | null>(null);
	const [cursorIndex, setCursorIndex] = useState(() => promptInput.length);
	const [mentionOpen, setMentionOpen] = useState(false);
	const [activeMention, setActiveMention] = useState<ActiveMention | null>(
		null,
	);
	const [mentionFiles, setMentionFiles] = useState<string[]>([]);
	const [mentionLoading, setMentionLoading] = useState(false);
	const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);
	const mentionResultsCacheRef = useRef(new Map<string, string[]>());
	const mentionLastRequestKeyRef = useRef<string | null>(null);
	const tokensSummary = useMemo(() => {
		const total = summary.tokensIn + summary.tokensOut;
		if (total === 0) {
			return undefined;
		}
		return `${total.toLocaleString()} tokens`;
	}, [summary.tokensIn, summary.tokensOut]);

	useEffect(() => {
		setCursorIndex((prev) => Math.min(prev, promptInput.length));
	}, [promptInput.length]);

	useEffect(() => {
		const nextMention = getActiveMention(promptInput, cursorIndex);
		setActiveMention(nextMention);
		setMentionOpen(nextMention !== null);
	}, [promptInput, cursorIndex]);

	useEffect(() => {
		if (!mentionOpen || !activeMention) {
			setMentionFiles([]);
			setMentionLoading(false);
			setMentionSelectedIndex(0);
			return;
		}

		const requestKey = `${workspaceRoot}::${activeMention.query}`;
		if (mentionLastRequestKeyRef.current === requestKey) {
			return;
		}
		mentionLastRequestKeyRef.current = requestKey;
		const cached = mentionResultsCacheRef.current.get(requestKey);
		if (cached) {
			setMentionFiles(cached);
			setMentionSelectedIndex(0);
			setMentionLoading(false);
			return;
		}

		let cancelled = false;
		const timeoutId = window.setTimeout(async () => {
			if (mentionFiles.length === 0) {
				setMentionLoading(true);
			}
			try {
				const results = await invoke<string[]>("search_workspace_files", {
					workspaceRoot,
					query: activeMention.query,
					limit: 10,
				});
				if (cancelled) {
					return;
				}
				const nextResults = Array.isArray(results) ? results : [];
				mentionResultsCacheRef.current.set(requestKey, nextResults);
				setMentionFiles(nextResults);
				setMentionSelectedIndex(0);
			} catch {
				if (cancelled) {
					return;
				}
				if (mentionFiles.length === 0) {
					setMentionFiles([]);
				}
			} finally {
				if (!cancelled) {
					setMentionLoading(false);
				}
			}
		}, 120);

		return () => {
			cancelled = true;
			window.clearTimeout(timeoutId);
		};
	}, [activeMention, mentionOpen, workspaceRoot, mentionFiles.length]);

	const insertMentionFile = useCallback(
		(filePath: string) => {
			if (!activeMention) {
				return;
			}
			const nextValue =
				`${promptInput.slice(0, activeMention.start)}@${filePath} ` +
				promptInput.slice(activeMention.end);
			onPromptInputChange(nextValue);
			setMentionOpen(false);
			const nextCursor = activeMention.start + filePath.length + 2;
			requestAnimationFrame(() => {
				const input = promptInputRef.current;
				if (!input) {
					return;
				}
				input.focus();
				input.setSelectionRange(nextCursor, nextCursor);
				setCursorIndex(nextCursor);
			});
		},
		[activeMention, onPromptInputChange, promptInput],
	);

	return (
		<div className="border-t border-border bg-card">
			{/* Input area */}
			<div className="px-4 py-3">
				<div className="relative">
					{mentionOpen && (
						<div className="absolute inset-x-0 bottom-full z-50 mb-1 max-h-56 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-xl">
							{mentionFiles.length === 0 ? (
								<div className="px-3 py-2 text-xs text-muted-foreground">
									{mentionLoading ? "Searching files..." : "No matching files"}
								</div>
							) : (
								<>
									{mentionFiles.map((filePath, index) => (
										<button
											className={cn(
												"block w-full rounded-md px-3 py-2 text-left text-xs transition-colors",
												index === mentionSelectedIndex
													? "bg-accent text-foreground"
													: "text-muted-foreground hover:bg-accent hover:text-foreground",
											)}
											key={filePath}
											onClick={() => insertMentionFile(filePath)}
											type="button"
										>
											{filePath}
										</button>
									))}
									{mentionLoading && (
										<div className="px-3 py-1 text-[10px] text-muted-foreground">
											Updating...
										</div>
									)}
								</>
							)}
						</div>
					)}
					<div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2.5 focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20 transition-all">
						<input
							className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
							onChange={(e) => {
								onPromptInputChange(e.target.value);
								setCursorIndex(
									e.target.selectionStart ?? e.target.value.length,
								);
							}}
							onClick={(e) =>
								setCursorIndex(
									e.currentTarget.selectionStart ?? promptInput.length,
								)
							}
							onKeyDown={(e) => {
								if (mentionOpen && mentionFiles.length > 0) {
									if (e.key === "ArrowDown") {
										e.preventDefault();
										setMentionSelectedIndex(
											(prev) => (prev + 1) % mentionFiles.length,
										);
										return;
									}
									if (e.key === "ArrowUp") {
										e.preventDefault();
										setMentionSelectedIndex(
											(prev) =>
												(prev - 1 + mentionFiles.length) % mentionFiles.length,
										);
										return;
									}
									if (e.key === "Enter" || e.key === "Tab") {
										e.preventDefault();
										insertMentionFile(mentionFiles[mentionSelectedIndex]);
										return;
									}
								}
								if (mentionOpen && e.key === "Escape") {
									e.preventDefault();
									setMentionOpen(false);
									return;
								}
								if (e.key === "Enter" && !e.shiftKey) {
									e.preventDefault();
									if (canAbort) {
										onAbort();
									} else if (canSend) {
										onSend();
									}
								}
							}}
							onKeyUp={(e) =>
								setCursorIndex(
									e.currentTarget.selectionStart ?? promptInput.length,
								)
							}
							placeholder={
								isBusy ? "Agent is working..." : "Ask follow-up questions"
							}
							ref={promptInputRef}
							value={promptInput}
						/>
					</div>
				</div>
				{attachments.length > 0 && (
					<div className="mt-2 flex flex-wrap gap-1.5">
						{attachments.map((attachment) => (
							<span
								className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-1 text-xs text-foreground"
								key={attachment.id}
							>
								{attachment.isImage ? "image:" : "file:"} {attachment.name}
								<button
									className="rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
									onClick={() => onRemoveAttachment(attachment.id)}
									type="button"
								>
									<X className="h-3 w-3" />
								</button>
							</span>
						))}
					</div>
				)}
			</div>

			{/* Controls row */}
			<div className="flex items-center justify-between px-4 pb-2">
				<div className="flex items-center gap-1">
					<button
						className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
						onClick={() => fileInputRef.current?.click()}
						type="button"
					>
						<Paperclip className="h-4 w-4" />
					</button>
					<input
						accept="*/*"
						className="hidden"
						multiple
						onChange={(event) => {
							const files = Array.from(event.target.files ?? []);
							if (files.length > 0) {
								onAttachFiles(files);
							}
							event.currentTarget.value = "";
						}}
						ref={fileInputRef}
						type="file"
					/>

					<ModelSelector
						isBusy={isBusy}
						model={model}
						onModelChange={onModelChange}
						onModelSupportsReasoningChange={setModelSupportsReasoning}
						onProviderChange={onProviderChange}
						provider={provider}
					/>

					<EffortSelector disabled={!modelSupportsReasoning} />
				</div>

				<div className="flex items-center gap-1">
					<button
						className="hidden rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
						type="button"
					>
						<Mic className="h-4 w-4" />
					</button>
					<button
						className="rounded-full bg-foreground p-1.5 text-background hover:bg-foreground/80 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
						disabled={!canSend && !canAbort}
						onClick={canAbort ? onAbort : onSend}
						type="button"
					>
						{canAbort ? (
							<CircleStop className="h-4 w-4" />
						) : (
							<ArrowUp className="h-4 w-4" />
						)}
					</button>
				</div>
			</div>

			{/* Status bar */}
			<div className="flex items-center justify-between border-t border-border px-4 py-1.5 text-[11px] text-muted-foreground">
				<div className="flex items-center gap-3">
					<StatusItem
						label={mode === "act" ? "Act" : "Plan"}
						onClick={onModeToggle}
					/>
					{tokensSummary && <StatusItem icon={Coins} label={tokensSummary} />}
				</div>
				{/* GIT BRANCH */}
				<div className="flex items-center gap-3">
					<GitBranchSelector
						currentBranch={gitBranch}
						onListGitBranches={onListGitBranches}
						onListWorkspaces={onListWorkspaces}
						onSwitchGitBranch={onSwitchGitBranch}
						onSwitchWorkspace={onSwitchWorkspace}
						workspaceRoot={workspaceRoot}
					/>
					<button
						className="hidden items-center gap-1 hover:text-foreground transition-colors"
						onClick={onRefreshGitBranch}
						type="button"
					>
						<RotateCcw className="h-3 w-3" />
					</button>
					<button
						className="hidden items-center gap-1 hover:text-foreground transition-colors"
						onClick={onReset}
						type="button"
					>
						<RotateCcw className="h-4 w-4" />
					</button>
				</div>
			</div>
		</div>
	);
}

function GitBranchSelector({
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

	const formatWorkspaceLabel = useCallback((workspacePath: string): string => {
		const trimmed = workspacePath.trim();
		if (!trimmed) {
			return workspacePath;
		}
		const unixHome = trimmed.match(/^\/Users\/[^/]+\/(.*)$/);
		if (unixHome) {
			return unixHome[1] ? `~/${unixHome[1]}` : "~";
		}
		const linuxHome = trimmed.match(/^\/home\/[^/]+\/(.*)$/);
		if (linuxHome) {
			return linuxHome[1] ? `~/${linuxHome[1]}` : "~";
		}
		const windowsHome = trimmed.match(/^[A-Za-z]:\\Users\\[^\\]+\\(.*)$/);
		if (windowsHome) {
			const tail = windowsHome[1]?.replaceAll("\\", "/") || "";
			return tail ? `~/${tail}` : "~";
		}
		return workspacePath;
	}, []);

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
		setLoadingBranches(true);
		try {
			const branchPayload = await onListGitBranches();
			setBranches(branchPayload.branches);
		} finally {
			setLoadingBranches(false);
		}
	};

	const handleSelect = async (branch: string) => {
		if (branch === currentBranch || switching) {
			setOpen(false);
			return;
		}
		setSwitching(true);
		const switched = await onSwitchGitBranch(branch);
		setSwitching(false);
		if (switched) {
			setOpen(false);
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
		}
	};

	return (
		<div className="relative">
			<button
				className="flex items-center gap-1 hover:text-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-60"
				disabled={switching}
				id="git-branch-btn"
				onClick={() => {
					if (open) {
						setOpen(false);
						return;
					}
					void openMenu();
				}}
				type="button"
			>
				<GitBranch className="h-3 w-3" />
				<span className="max-w-20 truncate">{workspaceName}</span>
				<span className="text-muted-foreground">/</span>
				<span className="max-w-20 truncate">{currentBranch}</span>
				<ChevronDown className="h-2.5 w-2.5" />
			</button>
			{open && (
				<div className="absolute bottom-full right-0 z-50 mb-1 w-56 rounded-lg border border-border bg-popover p-1 shadow-xl">
					{loadingBranches ? (
						<div className="px-3 py-2 text-xs text-muted-foreground">
							Loading branches...
						</div>
					) : (
						<div className="space-y-1">
							<div className="px-2 pt-1 text-[10px] uppercase text-muted-foreground">
								Workspaces
							</div>
							<div className="max-h-28 overflow-y-auto">
								{workspaces.length === 0 ? (
									<div className="px-3 py-2 text-xs text-muted-foreground">
										No workspaces found
									</div>
								) : (
									workspaces.map((workspacePath) => (
										<button
											className={cn(
												"flex w-full items-center justify-between rounded-md px-3 py-2 text-xs transition-colors",
												workspacePath === workspaceRoot
													? "bg-accent text-foreground"
													: "text-muted-foreground hover:bg-accent hover:text-foreground",
											)}
											key={workspacePath}
											onClick={() => {
												void handleWorkspaceSelect(workspacePath);
											}}
											type="button"
										>
											<span className="truncate">
												{formatWorkspaceLabel(workspacePath)}
											</span>
										</button>
									))
								)}
							</div>
							<button
								className="flex w-full items-center rounded-md px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
								disabled={switchingWorkspace}
								onClick={() => {
									const proposed = window.prompt(
										"Enter workspace path",
										workspaceRoot,
									);
									if (!proposed) {
										return;
									}
									void handleWorkspaceSelect(proposed);
								}}
								type="button"
							>
								Switch workspace path...
							</button>
							<div className="px-2 pt-1 text-[10px] uppercase text-muted-foreground">
								Branches
							</div>
							<div className="max-h-28 overflow-y-auto">
								{branches.length === 0 ? (
									<div className="px-3 py-2 text-xs text-muted-foreground">
										No branches found
									</div>
								) : (
									branches.map((branch) => (
										<button
											className={cn(
												"flex w-full items-center justify-between rounded-md px-3 py-2 text-xs transition-colors",
												branch === currentBranch
													? "bg-accent text-foreground"
													: "text-muted-foreground hover:bg-accent hover:text-foreground",
											)}
											key={branch}
											onClick={() => {
												void handleSelect(branch);
											}}
											type="button"
										>
											<span className="truncate">{branch}</span>
										</button>
									))
								)}
							</div>
						</div>
					)}
				</div>
			)}
		</div>
	);
}

function ModelSelector({
	provider,
	model,
	isBusy,
	onProviderChange,
	onModelChange,
	onModelSupportsReasoningChange,
}: {
	provider: string;
	model: string;
	isBusy: boolean;
	onProviderChange: (provider: string) => void;
	onModelChange: (model: string) => void;
	onModelSupportsReasoningChange: (supportsReasoning: boolean) => void;
}) {
	const [providerModels, setProviderModels] = useState<
		Record<string, string[]>
	>(FALLBACK_PROVIDER_MODELS);
	const [providerReasoningModels, setProviderReasoningModels] = useState<
		Record<string, string[]>
	>(FALLBACK_PROVIDER_REASONING_MODELS);
	const [enabledProviderIds, setEnabledProviderIds] = useState<string[]>([]);
	const [lastSelection, setLastSelection] = useState(() =>
		readModelSelectionStorageFromWindow(),
	);
	const visibleProviderModels = useMemo(() => {
		const next: Record<string, string[]> = {};
		for (const providerId of enabledProviderIds) {
			next[providerId] = providerModels[providerId] ?? [];
		}
		return next;
	}, [enabledProviderIds, providerModels]);
	const providers = useMemo(
		() => Object.keys(visibleProviderModels),
		[visibleProviderModels],
	);
	const modelsForProvider = visibleProviderModels[provider] ?? [];

	useEffect(() => {
		const abortController = new AbortController();

		async function loadModelCatalog() {
			try {
				const response = await fetch("/api/models-catalog", {
					signal: abortController.signal,
					cache: "no-store",
				});
				if (!response.ok) {
					return;
				}
				const payload = (await response.json()) as {
					providerModels?: Record<string, string[]>;
					providerReasoningModels?: Record<string, string[]>;
				};
				const nextProviderModels = payload.providerModels;
				const nextProviderReasoningModels = payload.providerReasoningModels;
				if (
					!nextProviderModels ||
					Object.keys(nextProviderModels).length === 0
				) {
					return;
				}
				setProviderModels(nextProviderModels);
				if (
					nextProviderReasoningModels &&
					Object.keys(nextProviderReasoningModels).length > 0
				) {
					setProviderReasoningModels(nextProviderReasoningModels);
				}
			} catch {
				// Keep local fallback values when API is unavailable.
			}
		}

		void loadModelCatalog();
		return () => abortController.abort();
	}, []);

	useEffect(() => {
		let cancelled = false;

		async function loadEnabledProviders() {
			try {
				const payload = await invoke<{
					providers?: Array<{ id?: string; enabled?: boolean }>;
				}>("list_provider_catalog");
				if (cancelled) {
					return;
				}
				const enabled = (payload.providers ?? [])
					.filter((item) => item?.enabled && typeof item.id === "string")
					.map((item) => item.id as string);
				setEnabledProviderIds(enabled);
			} catch {
				// Keep model catalog-only fallback when provider catalog is unavailable.
			}
		}

		void loadEnabledProviders();
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		setLastSelection((prev) => {
			if (!provider || !model) {
				return prev;
			}
			if (
				prev.lastProvider === provider &&
				prev.lastModelByProvider[provider] === model
			) {
				return prev;
			}
			return {
				lastProvider: provider,
				lastModelByProvider: {
					...prev.lastModelByProvider,
					[provider]: model,
				},
			};
		});
	}, [model, provider]);

	useEffect(() => {
		try {
			writeModelSelectionStorageToWindow(lastSelection);
		} catch {
			// Ignore localStorage persistence failures.
		}
	}, [lastSelection]);

	useEffect(() => {
		if (providers.length === 0) {
			return;
		}

		if (!providers.includes(provider)) {
			onProviderChange(providers[0]);
			return;
		}

		if (!modelsForProvider.includes(model)) {
			const firstModel = modelsForProvider[0];
			if (firstModel) {
				onModelChange(firstModel);
			}
		}
	}, [
		model,
		modelsForProvider,
		onModelChange,
		onProviderChange,
		provider,
		providers,
	]);

	useEffect(() => {
		onModelSupportsReasoningChange(
			hasReasoningCapability(providerReasoningModels, provider, model),
		);
	}, [
		model,
		onModelSupportsReasoningChange,
		provider,
		providerReasoningModels,
	]);

	return (
		<div className="flex items-center gap-1 text-xxs">
			<Combobox
				items={providers}
				onValueChange={(value) => {
					if (!value) {
						return;
					}
					onProviderChange(value);
					const rememberedModel = lastSelection.lastModelByProvider[value];
					const providerModelIds = visibleProviderModels[value] ?? [];
					if (
						rememberedModel &&
						providerModelIds.includes(rememberedModel) &&
						rememberedModel !== model
					) {
						onModelChange(rememberedModel);
						return;
					}
					const firstModel = providerModelIds[0];
					if (firstModel && firstModel !== model) {
						onModelChange(firstModel);
					}
				}}
				value={provider}
			>
				<ComboboxInput
					className="h-7 text-xxs"
					disabled={isBusy || providers.length === 0}
					readOnly
					showClear={false}
					showTrigger
				/>
				<ComboboxContent>
					<ComboboxEmpty>No providers found.</ComboboxEmpty>
					<ComboboxList>
						{(item) => (
							<ComboboxItem className="text-xxs" key={item} value={item}>
								{item}
							</ComboboxItem>
						)}
					</ComboboxList>
				</ComboboxContent>
			</Combobox>

			<Combobox
				items={modelsForProvider}
				onValueChange={(value) => {
					if (!value) {
						return;
					}
					onModelChange(value);
				}}
				value={model}
			>
				<ComboboxInput
					className="h-7"
					disabled={isBusy || modelsForProvider.length === 0}
					readOnly
					showClear={false}
					showTrigger
				/>
				<ComboboxContent>
					<ComboboxEmpty>No models found.</ComboboxEmpty>
					<ComboboxList>
						{(item) => (
							<ComboboxItem className="text-xxs" key={item} value={item}>
								{item}
							</ComboboxItem>
						)}
					</ComboboxList>
				</ComboboxContent>
			</Combobox>
		</div>
	);
}

function EffortSelector({ disabled }: { disabled: boolean }) {
	const effortLevels = ["Low", "Medium", "High"];
	const [effort, setEffort] = useState("Medium");

	return (
		<Combobox
			items={effortLevels}
			onValueChange={(value) => {
				if (!value) {
					return;
				}
				setEffort(value);
			}}
			value={effort}
		>
			<ComboboxInput
				className="h-7"
				disabled={disabled}
				readOnly
				showClear={false}
				showTrigger
			/>
			<ComboboxContent>
				<ComboboxEmpty>No options found.</ComboboxEmpty>
				<ComboboxList>
					{(item) => (
						<ComboboxItem className="text-xxs" key={item} value={item}>
							{item}
						</ComboboxItem>
					)}
				</ComboboxList>
			</ComboboxContent>
		</Combobox>
	);
}

function StatusItem({
	icon: Icon,
	label,
	onClick,
}: {
	icon?: React.ComponentType<{ className?: string }>;
	label: string;
	onClick?: () => void;
}) {
	return (
		<button
			className="flex items-center gap-1 hover:text-foreground transition-colors"
			onClick={onClick}
			type="button"
		>
			{Icon ? <Icon className="h-3 w-3" /> : null}
			<span>{label}</span>
			<ChevronDown className="h-2.5 w-2.5" />
		</button>
	);
}
