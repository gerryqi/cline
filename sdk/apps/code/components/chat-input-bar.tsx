"use client";

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
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
} from "@/components/ui/combobox";
import type { ChatSessionStatus } from "@/lib/chat-schema";
import { cn } from "@/lib/utils";

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

type ChatInputBarProps = {
	status: ChatSessionStatus;
	provider: string;
	model: string;
	mode: "act" | "plan";
	gitBranch: string;
	workspaceRoot: string;
	promptInput: string;
	onPromptInputChange: (value: string) => void;
	onProviderChange: (provider: string) => void;
	onModelChange: (model: string) => void;
	onModeToggle: () => void;
	onRefreshGitBranch: () => void;
	onListGitBranches: () => Promise<{ current: string; branches: string[] }>;
	onListWorkspaces: () => Promise<string[]>;
	onSwitchGitBranch: (branch: string) => Promise<boolean>;
	onSwitchWorkspace: (workspacePath: string) => Promise<boolean>;
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
	onListWorkspaces,
	onSwitchGitBranch,
	onSwitchWorkspace,
	onSend,
	onAbort,
	onReset,
	attachments,
	onAttachFiles,
	onRemoveAttachment,
	summary,
	workspaceRoot,
}: ChatInputBarProps) {
	const isBusy =
		status === "starting" || status === "running" || status === "stopping";
	const [modelSupportsReasoning, setModelSupportsReasoning] = useState(() =>
		hasReasoningCapability(FALLBACK_PROVIDER_REASONING_MODELS, provider, model),
	);
	const actionLabel = status === "running" ? "Stop" : "Send";
	const canSend =
		(promptInput.trim().length > 0 || attachments.length > 0) && !isBusy;
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const tokensSummary = useMemo(() => {
		const total = summary.tokensIn + summary.tokensOut;
		if (total === 0) {
			return undefined;
		}
		return `${total.toLocaleString()} tokens`;
	}, [summary.tokensIn, summary.tokensOut]);

	return (
		<div className="border-t border-border bg-card">
			{/* Input area */}
			<div className="px-4 py-3">
				<div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2.5 focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20 transition-all">
					<input
						className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
						onChange={(e) => onPromptInputChange(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault();
								if (status === "running") {
									onAbort();
								} else if (canSend) {
									onSend();
								}
							}
						}}
						placeholder={
							isBusy ? "Agent is working..." : "Ask follow-up questions"
						}
						value={promptInput}
					/>
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
						disabled={!canSend && status !== "running"}
						onClick={status === "running" ? onAbort : onSend}
						type="button"
					>
						{status === "running" ? (
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
	const [loading, setLoading] = useState(false);
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

	const openMenu = async () => {
		setOpen(true);
		setLoading(true);
		try {
			const [branchPayload, workspacePayload] = await Promise.all([
				onListGitBranches(),
				onListWorkspaces(),
			]);
			setBranches(branchPayload.branches);
			setWorkspaces(workspacePayload);
		} finally {
			setLoading(false);
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
					{loading ? (
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
	const providers = useMemo(
		() => Object.keys(providerModels),
		[providerModels],
	);
	const modelsForProvider = providerModels[provider] ?? [];

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
		<div className="flex items-center gap-1">
			<Combobox
				items={providers}
				onValueChange={(value) => {
					if (!value) {
						return;
					}
					onProviderChange(value);
				}}
				value={provider}
			>
				<ComboboxInput
					className="h-7"
					disabled={isBusy || providers.length === 0}
					readOnly
					showClear={false}
					showTrigger
				/>
				<ComboboxContent>
					<ComboboxList>
						{providers.map((value) => (
							<ComboboxItem className="text-xs" key={value} value={value}>
								{value}
							</ComboboxItem>
						))}
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
					<ComboboxList>
						{modelsForProvider.map((value) => (
							<ComboboxItem
								className="font-mono text-xs"
								key={value}
								value={value}
							>
								{value}
							</ComboboxItem>
						))}
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
				<ComboboxList>
					{effortLevels.map((level) => (
						<ComboboxItem className="text-xs" key={level} value={level}>
							{level}
						</ComboboxItem>
					))}
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
