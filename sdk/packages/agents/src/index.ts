/**
 * @cline/agents
 *
 * Public API for building agentic loops.
 */

// =============================================================================
// Core Agent
// =============================================================================

export { Agent, createAgent } from "./agent.js";

// =============================================================================
// Tooling (consumer-facing)
// =============================================================================

export {
	ALL_DEFAULT_TOOL_NAMES,
	type AskQuestionExecutor,
	type BashExecutor,
	type CreateBuiltinToolsOptions,
	type CreateDefaultToolsOptions,
	createBuiltinTools,
	createDefaultExecutors,
	type DefaultExecutorsOptions,
	type DefaultToolName,
	DefaultToolNames,
	type DefaultToolsConfig,
	type EditorExecutor,
	type FileReadExecutor,
	type SearchExecutor,
	type SkillsExecutor,
	type SkillsExecutorSkillMetadata,
	type SkillsExecutorWithMetadata,
	type ToolExecutors,
	type ToolPolicyPresetName,
	type ToolPresetName,
	ToolPresets,
	type WebFetchExecutor,
} from "./default-tools/index.js";
export {
	createTool,
	toToolDefinition,
	toToolDefinitions,
} from "./tools/index.js";

// =============================================================================
// Hooks
// =============================================================================

export {
	createSubprocessHooks,
	type HookEventName,
	HookEventNameSchema,
	type HookEventPayload,
	HookEventPayloadSchema,
	parseHookEventPayload,
	type RunHookOptions,
	type RunHookResult,
	runHook,
	type SubprocessHookControl,
	type SubprocessHooksOptions,
} from "./hooks/index.js";

// =============================================================================
// Prompts and formatting
// =============================================================================

export { formatFileContentBlock } from "@cline/shared";
export { getClineDefaultSystemPrompt } from "./prompts/index.js";

// =============================================================================
// Teams and spawn support
// =============================================================================

export {
	AgentTeamsRuntime,
	type AgentTeamsRuntimeOptions,
	type BootstrapAgentTeamsOptions,
	type BootstrapAgentTeamsResult,
	bootstrapAgentTeams,
	type CreateAgentTeamsToolsOptions,
	createAgentTeamsTools,
	createSpawnAgentTool,
	type SubAgentEndContext,
	type SubAgentStartContext,
	type TeamEvent,
	type TeammateLifecycleSpec,
	type TeamTeammateRuntimeConfig,
	type TeamTeammateSpec,
} from "./teams/index.js";

// =============================================================================
// MCP bridge
// =============================================================================

export {
	type CreateDisabledMcpToolPoliciesOptions,
	type CreateDisabledMcpToolPolicyOptions,
	type CreateMcpToolsOptions,
	createDisabledMcpToolPolicies,
	createDisabledMcpToolPolicy,
	createMcpTools,
	type McpToolCallRequest,
	type McpToolCallResult,
	type McpToolDescriptor,
	type McpToolNameTransform,
	type McpToolProvider,
} from "./mcp/index.js";

// =============================================================================
// Public types
// =============================================================================

export {
	type AgentConfig,
	AgentConfigSchema,
	type AgentEvent,
	type AgentHooks,
	type AgentResult,
	AgentResultSchema,
	type AgentUsage,
	AgentUsageSchema,
	type ContentBlock,
	type HookErrorMode,
	type Message,
	type ModelInfo,
	type Tool,
	type ToolApprovalRequest,
	type ToolApprovalResult,
	type ToolCallRecord,
	ToolCallRecordSchema,
	type ToolContext,
	ToolContextSchema,
	type ToolPolicy,
} from "./types.js";
