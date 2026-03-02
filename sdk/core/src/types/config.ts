import type { AgentHooks, HookErrorMode, TeamEvent, Tool } from "@cline/agents";
import type { ModelInfo } from "@cline/llms/providers";

export interface CoreModelConfig {
	providerId: string;
	modelId: string;
	apiKey?: string;
	baseUrl?: string;
	knownModels?: Record<string, ModelInfo>;
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
	extraTools?: Tool[];
	onTeamEvent?: (event: TeamEvent) => void;
}
