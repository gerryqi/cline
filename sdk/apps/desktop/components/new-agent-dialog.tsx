"use client";

import { Plus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface NewAgentDialogProps {
	defaultWorkspaceRoot: string;
	defaultCwd: string;
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
}

const AGENT_TYPES = ["Cline", "Planner", "Coder", "Reviewer", "Fixer"];
const FALLBACK_PROVIDER_MODELS: Record<string, string[]> = {
	anthropic: ["claude-sonnet-4-6"],
	openai: ["gpt-4.1"],
};

export function NewAgentDialog({
	defaultWorkspaceRoot,
	defaultCwd,
	onCreateAgent,
}: NewAgentDialogProps) {
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const [type, setType] = useState(AGENT_TYPES[0]);
	const [providerModels, setProviderModels] = useState<
		Record<string, string[]>
	>(FALLBACK_PROVIDER_MODELS);
	const [provider, setProvider] = useState(
		Object.keys(FALLBACK_PROVIDER_MODELS)[0],
	);
	const [model, setModel] = useState(
		FALLBACK_PROVIDER_MODELS[Object.keys(FALLBACK_PROVIDER_MODELS)[0]][0] ?? "",
	);
	const [branch, setBranch] = useState("");
	const [teamName, setTeamName] = useState("kanban-team");
	const [workspaceRoot, setWorkspaceRoot] = useState(defaultWorkspaceRoot);
	const [cwd, setCwd] = useState(defaultCwd || defaultWorkspaceRoot);
	const [apiKey, setApiKey] = useState("");
	const [systemPrompt, setSystemPrompt] = useState("");
	const [maxIterations, setMaxIterations] = useState("");
	const [enableTools, setEnableTools] = useState(true);
	const [enableSpawn, setEnableSpawn] = useState(true);
	const [enableTeams, setEnableTeams] = useState(true);
	const [autoApproveTools, setAutoApproveTools] = useState(true);
	const [tasks, setTasks] = useState<string[]>([""]);

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
				};
				const nextProviderModels = payload.providerModels;
				if (
					!nextProviderModels ||
					Object.keys(nextProviderModels).length === 0
				) {
					return;
				}

				setProviderModels(nextProviderModels);
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
			setProvider(providers[0]);
			return;
		}

		if (!modelsForProvider.includes(model)) {
			setModel(modelsForProvider[0] ?? "");
		}
	}, [model, modelsForProvider, provider, providers]);

	function addTask() {
		setTasks((prev) => [...prev, ""]);
	}

	function removeTask(index: number) {
		setTasks((prev) => prev.filter((_, i) => i !== index));
	}

	function updateTask(index: number, value: string) {
		setTasks((prev) => prev.map((t, i) => (i === index ? value : t)));
	}

	function handleSubmit() {
		const validTasks = tasks.map((task) => task.trim()).filter(Boolean);
		const resolvedName = name.trim();
		const resolvedWorkspaceRoot = workspaceRoot.trim();
		const resolvedCwd = cwd.trim() || resolvedWorkspaceRoot;
		if (
			!resolvedName ||
			validTasks.length === 0 ||
			!resolvedWorkspaceRoot ||
			!provider ||
			!model
		) {
			return;
		}

		onCreateAgent({
			name: resolvedName,
			type,
			provider,
			model,
			branch:
				branch.trim() ||
				`codex/${resolvedName.toLowerCase().replace(/\s+/g, "-")}`,
			taskNames: validTasks,
			workspaceRoot: resolvedWorkspaceRoot,
			cwd: resolvedCwd,
			teamName:
				teamName.trim() ||
				`kanban-${resolvedName.toLowerCase().replace(/\s+/g, "-")}`,
			enableTools,
			enableSpawn,
			enableTeams,
			autoApproveTools,
			prompt: validTasks.join("\n"),
			apiKey: apiKey.trim() || undefined,
			systemPrompt: systemPrompt.trim() || undefined,
			maxIterations: Number.isFinite(Number(maxIterations))
				? Number(maxIterations)
				: undefined,
		});

		setName("");
		setBranch("");
		setTasks([""]);
		setAutoApproveTools(true);
		setOpen(false);
	}

	const isValid =
		name.trim() !== "" &&
		tasks.some((task) => task.trim() !== "") &&
		workspaceRoot.trim() !== "";

	return (
		<Dialog onOpenChange={setOpen} open={open}>
			<DialogTrigger asChild>
				<Button
					className="h-8 gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90"
					size="sm"
				>
					<Plus className="h-3.5 w-3.5" />
					<span>New Agent</span>
				</Button>
			</DialogTrigger>
			<DialogContent className="max-h-[95dvh] overflow-y-auto border-border bg-card max-sm:max-w-[95vw] sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle className="text-foreground">
						Create New Agent Task
					</DialogTitle>
					<DialogDescription className="text-muted-foreground">
						Starts a CLI subprocess and tracks progress from session hooks.
					</DialogDescription>
				</DialogHeader>

				<div className="grid gap-3 py-2 sm:grid-cols-2">
					<label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
						Agent Name
						<input
							className="h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
							onChange={(event) => setName(event.target.value)}
							placeholder="Feature builder"
							value={name}
						/>
					</label>
					<label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
						Team Name
						<input
							className="h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
							onChange={(event) => setTeamName(event.target.value)}
							value={teamName}
						/>
					</label>
					<label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
						Type
						<select
							className="h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
							onChange={(event) => setType(event.target.value)}
							value={type}
						>
							{AGENT_TYPES.map((value) => (
								<option key={value} value={value}>
									{value}
								</option>
							))}
						</select>
					</label>
					<label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
						Provider
						<select
							className="h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
							onChange={(event) => setProvider(event.target.value)}
							value={provider}
						>
							{providers.map((value) => (
								<option key={value} value={value}>
									{value}
								</option>
							))}
						</select>
					</label>
					<label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
						Model
						<select
							className="h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
							disabled={modelsForProvider.length === 0}
							onChange={(event) => setModel(event.target.value)}
							value={model}
						>
							{modelsForProvider.map((value) => (
								<option key={value} value={value}>
									{value}
								</option>
							))}
						</select>
					</label>
					<label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
						Max Iterations
						<input
							className="h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
							onChange={(event) => setMaxIterations(event.target.value)}
							value={maxIterations}
						/>
					</label>
					<label className="flex flex-col gap-1.5 text-xs text-muted-foreground sm:col-span-2">
						Branch
						<input
							className="h-9 rounded-lg border border-border bg-background px-3 font-mono text-sm text-foreground"
							onChange={(event) => setBranch(event.target.value)}
							placeholder="codex/feature-branch"
							value={branch}
						/>
					</label>
					<label className="flex flex-col gap-1.5 text-xs text-muted-foreground sm:col-span-2">
						Workspace Root
						<input
							className="h-9 rounded-lg border border-border bg-background px-3 font-mono text-sm text-foreground"
							onChange={(event) => setWorkspaceRoot(event.target.value)}
							value={workspaceRoot}
						/>
					</label>
					<label className="flex flex-col gap-1.5 text-xs text-muted-foreground sm:col-span-2">
						Working Directory
						<input
							className="h-9 rounded-lg border border-border bg-background px-3 font-mono text-sm text-foreground"
							onChange={(event) => setCwd(event.target.value)}
							value={cwd}
						/>
					</label>
					<label className="flex flex-col gap-1.5 text-xs text-muted-foreground sm:col-span-2">
						API Key (optional)
						<input
							className="h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
							onChange={(event) => setApiKey(event.target.value)}
							type="password"
							value={apiKey}
						/>
					</label>
					<label className="flex flex-col gap-1.5 text-xs text-muted-foreground sm:col-span-2">
						System Prompt (optional)
						<textarea
							className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
							onChange={(event) => setSystemPrompt(event.target.value)}
							rows={3}
							value={systemPrompt}
						/>
					</label>
				</div>

				<div className="mb-2 grid grid-cols-3 gap-2 text-xs">
					<label className="flex items-center gap-2 text-muted-foreground">
						<input
							checked={enableTools}
							onChange={(event) => setEnableTools(event.target.checked)}
							type="checkbox"
						/>
						tools
					</label>
					<label className="flex items-center gap-2 text-muted-foreground">
						<input
							checked={enableSpawn}
							onChange={(event) => setEnableSpawn(event.target.checked)}
							type="checkbox"
						/>
						spawn
					</label>
					<label className="flex items-center gap-2 text-muted-foreground">
						<input
							checked={enableTeams}
							onChange={(event) => setEnableTeams(event.target.checked)}
							type="checkbox"
						/>
						teams
					</label>
				</div>
				<div className="mb-2 text-xs">
					<label className="flex items-center gap-2 text-muted-foreground">
						<input
							checked={autoApproveTools}
							onChange={(event) => setAutoApproveTools(event.target.checked)}
							type="checkbox"
						/>
						auto-approve tool calls
					</label>
				</div>

				<div className="flex flex-col gap-1.5">
					<div className="flex items-center justify-between">
						<p className="text-xs font-medium text-muted-foreground">Tasks</p>
						<button
							className="flex items-center gap-1 text-[10px] text-primary"
							onClick={addTask}
							type="button"
						>
							<Plus className="h-3 w-3" /> Add task
						</button>
					</div>
					<div className="flex flex-col gap-2">
						{tasks.map((task, index) => (
							<div className="flex items-center gap-2" key={task}>
								<span className="w-5 text-right font-mono text-[10px] text-muted-foreground">
									{index + 1}.
								</span>
								<input
									className="h-8 flex-1 rounded-lg border border-border bg-background px-3 text-xs text-foreground"
									onChange={(event) => updateTask(index, event.target.value)}
									placeholder="Task description"
									value={task}
								/>
								{tasks.length > 1 && (
									<button
										className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
										onClick={() => removeTask(index)}
										type="button"
									>
										<X className="h-3 w-3" />
									</button>
								)}
							</div>
						))}
					</div>
				</div>

				<DialogFooter>
					<Button
						className="text-muted-foreground"
						onClick={() => setOpen(false)}
						size="sm"
						type="button"
						variant="ghost"
					>
						Cancel
					</Button>
					<Button
						className={cn(
							"gap-1.5 bg-primary text-primary-foreground",
							!isValid && "opacity-50",
						)}
						disabled={!isValid}
						onClick={handleSubmit}
						size="sm"
						type="button"
					>
						<Plus className="h-3.5 w-3.5" />
						Create Agent
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
