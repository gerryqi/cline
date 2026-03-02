import type { AgentStatus as SessionAgentStatus } from "@/lib/session-types";
export type AgentStatus = SessionAgentStatus;

export interface FileDiff {
	path: string;
	additions: number;
	deletions: number;
	hunks: { oldStart: number; newStart: number; old: string; new: string }[];
	committed: boolean;
}

export interface AgentTask {
	id: string;
	name: string;
	status: AgentStatus;
	progress: number;
	file?: string;
	startedAt?: string;
	completedAt?: string;
}

export interface Agent {
	id: string;
	sessionId?: string;
	parentSessionId?: string;
	parentAgentId?: string;
	agentId?: string;
	conversationId?: string;
	isSubagent?: boolean;
	name: string;
	type: string;
	status: AgentStatus;
	progress: number;
	tasks: AgentTask[];
	model: string;
	provider: string;
	startedAt: string;
	completedAt?: string;
	tokensUsed: number;
	filesModified: number;
	currentFile?: string;
	branch?: string;
	logs: string[];
	fileDiffs: FileDiff[];
	workspaceRoot: string;
	cwd: string;
	prompt: string;
	teamName: string;
	enableTools: boolean;
	enableSpawn: boolean;
	enableTeams: boolean;
	autoApproveTools?: boolean;
	apiKey?: string;
	systemPrompt?: string;
	maxIterations?: number;
	hookEvents: number;
}

export interface CreateAgentInput {
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
}

export const COLUMNS: { id: AgentStatus; label: string }[] = [
	{ id: "queued", label: "Queued" },
	{ id: "running", label: "Running" },
	{ id: "completed", label: "Completed" },
	{ id: "failed", label: "Failed" },
];

let nextId = 1;

function formatNowTimestamp(): string {
	const date = new Date();
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
		date.getMinutes(),
	)}:${pad(date.getSeconds())}`;
}

export function createNewAgent(opts: CreateAgentInput): Agent {
	const id = `agent-${nextId++}`;

	return {
		id,
		name: opts.name,
		type: opts.type,
		model: opts.model,
		provider: opts.provider,
		status: "queued",
		progress: 0,
		startedAt: formatNowTimestamp(),
		tokensUsed: 0,
		filesModified: 0,
		branch: opts.branch,
		logs: ["Queued and ready to start"],
		fileDiffs: [],
		tasks: opts.taskNames.map((taskName, index) => ({
			id: `${id}-task-${index + 1}`,
			name: taskName,
			status: "queued",
			progress: 0,
		})),
		workspaceRoot: opts.workspaceRoot,
		cwd: opts.cwd,
		teamName: opts.teamName,
		enableTools: opts.enableTools,
		enableSpawn: opts.enableSpawn,
		enableTeams: opts.enableTeams,
		autoApproveTools: opts.autoApproveTools ?? true,
		prompt: opts.prompt,
		apiKey: opts.apiKey,
		systemPrompt: opts.systemPrompt,
		maxIterations: opts.maxIterations,
		hookEvents: 0,
	};
}
