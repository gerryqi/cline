import type {
	AgentHooks,
	AgentResult,
	AgentTeamsRuntime,
	Tool,
} from "@cline/agents";
import type { BasicLogger } from "@cline/shared";
import type { UserInstructionConfigWatcher } from "../agents";
import type { ToolExecutors } from "../default-tools";
import type { CoreSessionConfig } from "../types/config";

export interface BuiltRuntime {
	tools: Tool[];
	hooks?: AgentHooks;
	logger?: BasicLogger;
	teamRuntime?: AgentTeamsRuntime;
	shutdown: (reason: string) => Promise<void> | void;
}

export interface RuntimeBuilderInput {
	config: CoreSessionConfig;
	hooks?: AgentHooks;
	onTeamEvent?: (event: import("@cline/agents").TeamEvent) => void;
	createSpawnTool?: () => Tool;
	onTeamRestored?: () => void;
	userInstructionWatcher?: UserInstructionConfigWatcher;
	defaultToolExecutors?: Partial<ToolExecutors>;
	logger?: BasicLogger;
}

export interface RuntimeBuilder {
	build(input: RuntimeBuilderInput): BuiltRuntime;
}

export interface SessionRuntime {
	start(config: CoreSessionConfig): Promise<{ sessionId: string }>;
	send(sessionId: string, prompt: string): Promise<AgentResult | undefined>;
	abort(sessionId: string): Promise<void>;
	stop(sessionId: string): Promise<void>;
	poll(): Promise<string[]>;
}
