import type { CoreSessionConfig, SessionManifest } from "@cline/core/server";
import type { providers as LlmsProviders } from "@cline/llms";
import type {
	AgentMode,
	RpcChatRuntimeLoggerConfig,
	SessionLineage,
	ToolPolicy,
} from "@cline/shared";

export type CliOutputMode = "text" | "json";
export type CliAgentMode = AgentMode;

export interface Config extends Omit<CoreSessionConfig, "apiKey" | "mode"> {
	apiKey: string;
	knownModels?: Record<string, LlmsProviders.ModelInfo>;
	loggerConfig?: RpcChatRuntimeLoggerConfig;
	sandbox: boolean;
	sandboxDataDir?: string;
	thinking: boolean;
	missionLogIntervalSteps: number;
	missionLogIntervalMs: number;
	showUsage: boolean;
	showTimings: boolean;
	outputMode: CliOutputMode;
	mode: CliAgentMode;
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
	messages: LlmsProviders.Message[];
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

export interface SubagentSessionInput
	extends Required<
		Pick<SessionLineage, "agentId" | "parentAgentId" | "conversationId">
	> {
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
	outputMode: CliOutputMode;
	mode: CliAgentMode;
	thinking: boolean;
	liveModelCatalog: boolean;
	invalidOutputMode?: string;
	invalidMode?: string;
	sandbox: boolean;
	sandboxDir?: string;
	enableSpawnAgent: boolean;
	enableAgentTeams: boolean;
	enableTools: boolean;
	model?: string;
	provider?: string;
	sessionId?: string;
	maxIterations?: number;
	cwd?: string;
	teamName?: string;
	missionLogIntervalSteps?: number;
	missionLogIntervalMs?: number;
	defaultToolAutoApprove: boolean;
	toolPolicies: Record<string, ToolPolicy>;
}
