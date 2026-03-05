import type { AgentHooks, HookErrorMode, TeamEvent, Tool } from "@cline/agents";
import type { providers as LlmsProviders } from "@cline/llms";
import type { BasicLogger } from "@cline/shared";

export type CoreAgentMode = "act" | "plan";

export interface CoreModelConfig {
	providerId: string;
	modelId: string;
	apiKey?: string;
	baseUrl?: string;
	knownModels?: Record<string, LlmsProviders.ModelInfo>;
	/**
	 * Request model-side thinking/reasoning when supported.
	 */
	thinking?: boolean;
}

export interface CoreRuntimeFeatures {
	enableTools: boolean;
	enableSpawnAgent: boolean;
	enableAgentTeams: boolean;
}

export interface CoreSessionConfig
	extends CoreModelConfig,
		CoreRuntimeFeatures {
	mode?: CoreAgentMode;
	sessionId?: string;
	cwd: string;
	workspaceRoot?: string;
	systemPrompt: string;
	maxIterations?: number;
	teamName?: string;
	missionLogIntervalSteps?: number;
	missionLogIntervalMs?: number;
	hooks?: AgentHooks;
	hookErrorMode?: HookErrorMode;
	logger?: BasicLogger;
	extraTools?: Tool[];
	onTeamEvent?: (event: TeamEvent) => void;
}
