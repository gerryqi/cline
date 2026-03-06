"use client";

import { invoke } from "@tauri-apps/api/core";
import {
	Bot,
	Code,
	FileText,
	FolderOpen,
	Play,
	RefreshCw,
	TriangleAlert,
	Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

type ShortcutTab = "Rules" | "Workflows" | "Hooks" | "Skills" | "Agents";

type RuleItem = {
	name: string;
	instructions: string;
	path: string;
};

type WorkflowItem = {
	id: string;
	name: string;
	instructions: string;
	path: string;
};

type SkillItem = {
	name: string;
	description?: string;
	instructions: string;
	path: string;
};

type AgentItem = {
	name: string;
	path: string;
};

type HookItem = {
	fileName: string;
	hookEventName?: string;
	path: string;
};

type UserInstructionListsResponse = {
	workspaceRoot: string;
	rules: RuleItem[];
	workflows: WorkflowItem[];
	skills: SkillItem[];
	agents: AgentItem[];
	hooks: HookItem[];
	warnings: string[];
};

function previewText(input: string, maxLength = 150): string {
	const compact = input.replace(/\s+/g, " ").trim();
	if (compact.length <= maxLength) {
		return compact;
	}
	return `${compact.slice(0, maxLength).trimEnd()}...`;
}

function normalizePath(path: string): string {
	return path.replaceAll("\\", "/");
}

export function RulesView() {
	const [activeTab, setActiveTab] = useState<ShortcutTab>("Rules");
	const [isLoading, setIsLoading] = useState(true);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [workspaceRoot, setWorkspaceRoot] = useState("");
	const [rules, setRules] = useState<RuleItem[]>([]);
	const [workflows, setWorkflows] = useState<WorkflowItem[]>([]);
	const [skills, setSkills] = useState<SkillItem[]>([]);
	const [agents, setAgents] = useState<AgentItem[]>([]);
	const [hooks, setHooks] = useState<HookItem[]>([]);
	const [warnings, setWarnings] = useState<string[]>([]);

	const refresh = useCallback(async () => {
		setIsLoading(true);
		setErrorMessage(null);
		try {
			const response = await invoke<UserInstructionListsResponse>(
				"list_user_instruction_configs",
			);
			setWorkspaceRoot(response.workspaceRoot);
			setRules(response.rules);
			setWorkflows(response.workflows);
			setSkills(response.skills);
			setAgents(response.agents);
			setHooks(response.hooks);
			setWarnings(response.warnings);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setErrorMessage(message);
		} finally {
			setIsLoading(false);
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const tabs: ShortcutTab[] = [
		"Rules",
		"Workflows",
		"Hooks",
		"Skills",
		"Agents",
	];

	const { projectRules, globalRules } = useMemo(() => {
		const normalizedRoot = normalizePath(workspaceRoot);
		const project: RuleItem[] = [];
		const global: RuleItem[] = [];
		for (const rule of rules) {
			const normalized = normalizePath(rule.path);
			if (
				normalizedRoot &&
				normalized.startsWith(`${normalizedRoot}/`) &&
				normalized.includes("/.clinerules/")
			) {
				project.push(rule);
			} else {
				global.push(rule);
			}
		}
		return { projectRules: project, globalRules: global };
	}, [rules, workspaceRoot]);

	const { projectHooks, globalHooks } = useMemo(() => {
		const normalizedRoot = normalizePath(workspaceRoot);
		const project: HookItem[] = [];
		const global: HookItem[] = [];
		for (const hook of hooks) {
			const normalized = normalizePath(hook.path);
			if (
				normalizedRoot &&
				normalized.startsWith(`${normalizedRoot}/`) &&
				normalized.includes("/.clinerules/hooks")
			) {
				project.push(hook);
			} else {
				global.push(hook);
			}
		}
		return { projectHooks: project, globalHooks: global };
	}, [hooks, workspaceRoot]);

	return (
		<ScrollArea className="h-full">
			<div className="mx-auto max-w-3xl px-8 py-6">
				<div className="mb-4 flex items-center justify-between">
					<h2 className="text-lg font-semibold text-foreground">Extensions</h2>
					<Button
						variant="outline"
						size="sm"
						onClick={() => void refresh()}
						disabled={isLoading}
					>
						<RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
						Refresh
					</Button>
				</div>

				<div className="mb-6 flex items-center gap-0 border-b border-border">
					{tabs.map((tab) => (
						<Button
							key={tab}
							variant="ghost"
							onClick={() => setActiveTab(tab)}
							className={cn(
								"relative px-4 py-2.5 text-sm font-medium transition-colors",
								activeTab === tab
									? "text-foreground"
									: "text-muted-foreground hover:text-foreground",
							)}
						>
							{tab}
							{activeTab === tab && (
								<span className="absolute inset-x-0 -bottom-px h-0.5 bg-foreground" />
							)}
						</Button>
					))}
				</div>

				{errorMessage && (
					<div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
						Failed to load configuration lists: {errorMessage}
					</div>
				)}

				{warnings.length > 0 && (
					<div className="mb-4 rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-700 dark:text-yellow-300">
						<div className="mb-2 flex items-center gap-2 font-medium">
							<TriangleAlert className="h-4 w-4" />
							Partial results
						</div>
						<ul className="list-disc space-y-1 pl-5">
							{warnings.map((warning) => (
								<li key={warning}>{warning}</li>
							))}
						</ul>
					</div>
				)}

				{activeTab === "Rules" && (
					<div>
						<p className="mb-6 text-sm leading-relaxed text-muted-foreground">
							Enabled rules discovered from configured workspace/global
							directories.
						</p>

						<div className="mb-6">
							<h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
								Global Rules
							</h3>
							<div className="flex flex-col gap-2">
								{globalRules.map((rule) => (
									<div
										key={rule.path}
										className="rounded-lg border border-border px-4 py-3"
									>
										<div className="flex items-center gap-3">
											<FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
											<span className="flex-1 text-sm font-medium text-foreground">
												{rule.name}
											</span>
										</div>
										<p className="mt-2 text-xs text-muted-foreground">
											{previewText(rule.instructions)}
										</p>
										<p className="mt-1 text-xs font-mono text-muted-foreground">
											{rule.path}
										</p>
									</div>
								))}
								{globalRules.length === 0 && (
									<p className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
										No global rules found.
									</p>
								)}
							</div>
						</div>

						<div className="mb-2">
							<h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
								Project Rules
							</h3>
							<div className="flex flex-col gap-2">
								{projectRules.map((rule) => (
									<div
										key={rule.path}
										className="rounded-lg border border-border px-4 py-3"
									>
										<div className="flex items-center gap-3">
											<FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
											<span className="flex-1 text-sm font-medium text-foreground">
												{rule.name}
											</span>
										</div>
										<p className="mt-2 text-xs text-muted-foreground">
											{previewText(rule.instructions)}
										</p>
										<p className="mt-1 text-xs font-mono text-muted-foreground">
											{rule.path}
										</p>
									</div>
								))}
								{projectRules.length === 0 && (
									<p className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
										No project rules found.
									</p>
								)}
							</div>
						</div>
					</div>
				)}

				{activeTab === "Workflows" && (
					<div>
						<p className="mb-6 text-sm leading-relaxed text-muted-foreground">
							Enabled workflows. Invoke one in chat with{" "}
							<code className="rounded bg-secondary px-1.5 py-0.5 text-xs font-mono text-foreground">
								/workflow-name
							</code>
							.
						</p>

						<div className="flex flex-col gap-3">
							{workflows.map((workflow) => (
								<div
									key={workflow.path}
									className="rounded-lg border border-border px-5 py-4"
								>
									<div className="flex items-center gap-3">
										<Play className="h-4 w-4 shrink-0 text-primary" />
										<h3 className="text-sm font-semibold text-foreground">
											{workflow.name}
										</h3>
									</div>
									<p className="mt-2 ml-7 text-xs text-muted-foreground">
										{previewText(workflow.instructions)}
									</p>
									<p className="mt-1 ml-7 text-xs font-mono text-muted-foreground">
										{workflow.path}
									</p>
								</div>
							))}
							{workflows.length === 0 && (
								<p className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
									No enabled workflows found.
								</p>
							)}
						</div>
					</div>
				)}

				{activeTab === "Hooks" && (
					<div>
						<p className="mb-6 text-sm leading-relaxed text-muted-foreground">
							Hook config files discovered from workspace and global hook
							directories.
						</p>

						<div className="mb-6">
							<h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
								Global Hooks
							</h3>
							<div className="flex flex-col gap-2">
								{globalHooks.map((hook) => (
									<div
										key={hook.path}
										className="rounded-lg border border-border px-4 py-3"
									>
										<div className="flex items-center gap-3">
											<Code className="h-4 w-4 shrink-0 text-muted-foreground" />
											<span className="flex-1 text-sm font-mono text-foreground">
												{hook.fileName}
											</span>
											{hook.hookEventName && (
												<span className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground">
													{hook.hookEventName}
												</span>
											)}
										</div>
										<p className="mt-1 text-xs font-mono text-muted-foreground">
											{hook.path}
										</p>
									</div>
								))}
								{globalHooks.length === 0 && (
									<p className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
										No global hooks found.
									</p>
								)}
							</div>
						</div>

						<div>
							<div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
								<FolderOpen className="h-3.5 w-3.5" />
								Project Hooks
							</div>
							<div className="flex flex-col gap-2">
								{projectHooks.map((hook) => (
									<div
										key={hook.path}
										className="rounded-lg border border-border px-4 py-3"
									>
										<div className="flex items-center gap-3">
											<Code className="h-4 w-4 shrink-0 text-muted-foreground" />
											<span className="flex-1 text-sm font-mono text-foreground">
												{hook.fileName}
											</span>
											{hook.hookEventName && (
												<span className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground">
													{hook.hookEventName}
												</span>
											)}
										</div>
										<p className="mt-1 text-xs font-mono text-muted-foreground">
											{hook.path}
										</p>
									</div>
								))}
								{projectHooks.length === 0 && (
									<p className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
										No project hooks found.
									</p>
								)}
							</div>
						</div>
					</div>
				)}

				{activeTab === "Skills" && (
					<div>
						<p className="mb-6 text-sm leading-relaxed text-muted-foreground">
							Enabled skills discovered from workspace and global skill
							directories.
						</p>

						<div className="flex flex-col gap-3">
							{skills.map((skill) => (
								<div
									key={skill.path}
									className="rounded-lg border border-border px-5 py-4"
								>
									<div className="flex items-center gap-3">
										<Zap className="h-4 w-4 shrink-0 text-primary" />
										<h3 className="text-sm font-semibold text-foreground">
											{skill.name}
										</h3>
									</div>
									<p className="mt-2 ml-7 text-xs text-muted-foreground">
										{skill.description?.trim() ||
											previewText(skill.instructions)}
									</p>
									<p className="mt-1 ml-7 text-xs font-mono text-muted-foreground">
										{skill.path}
									</p>
								</div>
							))}
							{skills.length === 0 && (
								<p className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
									No enabled skills found.
								</p>
							)}
						</div>
					</div>
				)}

				{activeTab === "Agents" && (
					<div>
						<p className="mb-6 text-sm leading-relaxed text-muted-foreground">
							Configured agents discovered from Documents and settings
							directories.
						</p>

						<div className="flex flex-col gap-3">
							{agents.map((agent) => (
								<div
									key={agent.path}
									className="rounded-lg border border-border px-5 py-4"
								>
									<div className="flex items-center gap-3">
										<Bot className="h-4 w-4 shrink-0 text-primary" />
										<h3 className="text-sm font-semibold text-foreground">
											{agent.name}
										</h3>
									</div>
									<p className="mt-1 ml-7 text-xs font-mono text-muted-foreground">
										{agent.path}
									</p>
								</div>
							))}
							{agents.length === 0 && (
								<p className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
									No configured agents found.
								</p>
							)}
						</div>
					</div>
				)}
			</div>
		</ScrollArea>
	);
}
