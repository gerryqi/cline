import type { ToolPolicy } from "@cline/agents";
import type { CoreSessionConfig, SessionManifest } from "@cline/core/server";
import type { Message, ModelInfo } from "@cline/llms/providers";

export interface Config extends CoreSessionConfig {
	apiKey: string;
	knownModels?: Record<string, ModelInfo>;
	systemPrompt: string;
	enableSpawnAgent: boolean;
	enableAgentTeams: boolean;
	enableTools: boolean;
	cwd: string;
	teamName?: string;
	missionLogIntervalSteps: number;
	missionLogIntervalMs: number;
	showUsage: boolean;
	showTimings: boolean;
	defaultToolAutoApprove: boolean;
	toolPolicies: Record<string, ToolPolicy>;
}

export interface ActiveCliSession {
	manifestPath: string;
	transcriptPath: string;
	hookPath: string;
	messagesPath: string;
	manifest: SessionManifest;
}

export interface StoredApiMessages {
	version: 1;
	updated_at: string;
	messages: Message[];
}

export interface SessionDbRow {
	session_id: string;
	provider: string;
	model: string;
	cwd: string;
	workspace_root: string;
	team_name?: string | null;
	enable_tools: number;
	enable_spawn: number;
	enable_teams: number;
	prompt?: string | null;
}

export interface SubagentSessionInput {
	agentId: string;
	parentAgentId: string;
	conversationId: string;
	prompt?: string;
	rootSessionId?: string;
}

export interface ParsedArgs {
	prompt?: string;
	systemPrompt?: string;
	key?: string;
	interactive: boolean;
	showHelp: boolean;
	showVersion: boolean;
	showUsage: boolean;
	showTimings: boolean;
	enableSpawnAgent: boolean;
	enableAgentTeams: boolean;
	enableTools: boolean;
	model?: string;
	provider?: string;
	maxIterations?: number;
	cwd?: string;
	teamName?: string;
	missionLogIntervalSteps?: number;
	missionLogIntervalMs?: number;
	defaultToolAutoApprove: boolean;
	toolPolicies: Record<string, ToolPolicy>;
}
