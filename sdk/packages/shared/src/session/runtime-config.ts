import type { ToolPolicy } from "../llms/tools";

export type AgentMode = "act" | "plan";

export interface SessionPromptConfig {
	mode?: AgentMode;
	systemPrompt?: string;
	rules?: string;
	maxIterations?: number;
}

export interface SessionWorkspaceConfig {
	cwd: string;
	workspaceRoot?: string;
}

export interface SessionExecutionConfig {
	enableTools: boolean;
	teamName?: string;
	missionLogIntervalSteps?: number;
	missionLogIntervalMs?: number;
	maxConsecutiveMistakes?: number;
	toolPolicies?: Record<string, ToolPolicy>;
}
