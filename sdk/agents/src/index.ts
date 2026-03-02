/**
 * @cline/agents
 *
 * High-level SDK for building agentic loops with LLMs.
 *
 * This package provides a simple, powerful interface for creating AI agents
 * that can use tools, handle multi-turn conversations, and execute complex
 * tasks autonomously.
 *
 * ## Quick Start
 *
 * ```typescript
 * import { Agent, createTool } from "@cline/agents"
 *
 * // Define a tool
 * const readFile = createTool({
 *   name: "read_file",
 *   description: "Read the contents of a file",
 *   inputSchema: {
 *     type: "object",
 *     properties: {
 *       path: { type: "string", description: "File path to read" }
 *     },
 *     required: ["path"]
 *   },
 *   execute: async ({ path }) => {
 *     const content = await fs.readFile(path, "utf-8")
 *     return { content }
 *   }
 * })
 *
 * // Create an agent
 * const agent = new Agent({
 *   providerId: "anthropic",
 *   modelId: "claude-sonnet-4-20250514",
 *   apiKey: process.env.ANTHROPIC_API_KEY,
 *   systemPrompt: "You are a helpful coding assistant.",
 *   tools: [readFile],
 * })
 *
 * // Run the agent
 * const result = await agent.run("What's in the README.md file?")
 * console.log(result.text)
 * ```
 *
 * ## Features
 *
 * - **Simple API**: Create agents with a single configuration object
 * - **Tool Support**: Define tools with JSON Schema validation
 * - **Streaming**: Real-time event streaming for UI updates
 * - **Multi-Agent**: Coordinate multiple agents working together
 * - **Error Handling**: Built-in retry logic and error recovery
 * - **Provider Agnostic**: Works with Anthropic, OpenAI, Gemini, and more
 *
 * @module
 */

// =============================================================================
// Core Agent
// =============================================================================

export { Agent, createAgent } from "./agent.js";

// =============================================================================
// Extensions
// =============================================================================

export {
	AgentExtensionRunner,
	createExtensionRunner,
	discoverExtensionModules,
	type LoadExtensionModuleOptions,
	loadExtensionModule,
	loadExtensionsFromPaths,
} from "./extensions.js";

// =============================================================================
// Hooks
// =============================================================================

export {
	type AgentEndHookPayload,
	createSubprocessHooks,
	type HookEventName,
	type HookEventPayload,
	type HookEventPayloadBase,
	type RunHookOptions,
	type RunHookResult,
	runHook,
	type SessionShutdownHookPayload,
	type SubprocessHookControl,
	type SubprocessHooksOptions,
	type ToolCallHookPayload,
	type ToolResultHookPayload,
} from "./hooks.js";

// =============================================================================
// Prompts
// =============================================================================

export { getClineDefaultSystemPrompt } from "./prompts/index.js";

// =============================================================================
// Teams
// =============================================================================

export {
	type AgentTask,
	AgentTeam,
	AgentTeamsRuntime,
	type AgentTeamsRuntimeOptions,
	type AppendMissionLogInput,
	type BootstrapAgentTeamsOptions,
	type BootstrapAgentTeamsResult,
	bootstrapAgentTeams,
	type CreateAgentTeamsToolsOptions,
	type CreateTeamTaskInput,
	createAgentTeam,
	createAgentTeamsTools,
	createSpawnAgentTool,
	createWorkerReviewerTeam,
	FileTeamPersistenceStore,
	type FileTeamPersistenceStoreOptions,
	type MissionLogEntry,
	type MissionLogKind,
	type RouteToTeammateOptions,
	reviveTeamStateDates,
	type SpawnAgentInput,
	type SpawnAgentOutput,
	type SpawnAgentToolConfig,
	type SpawnTeammateOptions,
	type SubAgentEndContext,
	type SubAgentStartContext,
	sanitizeTeamName,
	type TaskResult,
	type TeamEvent,
	type TeamMailboxMessage,
	type TeamMemberConfig,
	type TeamMemberSnapshot,
	TeamMessageType,
	type TeamPersistenceStore,
	type TeamRunRecord,
	type TeamRunStatus,
	type TeamRuntimeSnapshot,
	type TeamRuntimeState,
	type TeamTask,
	type TeamTaskStatus,
	type TeamTeammateRuntimeConfig,
	type TeamTeammateSpec,
} from "./teams/index.js";

// =============================================================================
// Tool Utilities
// =============================================================================

export {
	// Creation
	createTool,
	// Registry
	createToolRegistry,
	// Execution
	executeTool,
	executeToolsInParallel,
	executeToolsSequentially,
	executeToolWithRetry,
	// Formatting
	formatToolCallRecord,
	formatToolResult,
	formatToolResultsSummary,
	getAllTools,
	getTool,
	getToolNames,
	hasTool,
	type ToolExecutionAuthorizer,
	type ToolExecutionObserver,
	toToolDefinition,
	toToolDefinitions,
	// Validation
	validateToolDefinition,
	validateToolInput,
	validateTools,
} from "./tools/index.js";

// =============================================================================
// Streaming
// =============================================================================

export {
	type AgentStream,
	batchEvents,
	collectEvents,
	filterEvents,
	mapEvents,
	streamContinue,
	streamRun,
	streamText,
} from "./streaming.js";

// =============================================================================
// Default Tools
// =============================================================================

export {
	// Constants
	ALL_DEFAULT_TOOL_NAMES,
	// Types
	type BashExecutor,
	type CreateBuiltinToolsOptions,
	type CreateDefaultToolsOptions,
	// Tool Creation Functions
	createBashTool,
	// Convenience: Tools with Built-in Executors
	createBuiltinTools,
	createDefaultTools,
	createDefaultToolsWithPreset,
	createEditorTool,
	createReadFilesTool,
	createSearchTool,
	createWebFetchTool,
	type DefaultToolName,
	DefaultToolNames,
	type DefaultToolsConfig,
	type EditFileInput,
	EditFileInputSchema,
	type EditorExecutor,
	type EditorExecutorInput,
	type FetchWebContentInput,
	// Zod Schemas (for validation and type inference)
	FetchWebContentInputSchema,
	type FileReadExecutor,
	type ReadFilesInput,
	ReadFilesInputSchema,
	type RunCommandsInput,
	RunCommandsInputSchema,
	type SearchCodebaseInput,
	SearchCodebaseInputSchema,
	type SearchExecutor,
	type ToolExecutors,
	type ToolOperationResult,
	type ToolPresetName,
	// Presets
	ToolPresets,
	// Zod Utilities
	validateWithZod,
	type WebFetchExecutor,
	type WebFetchRequest,
	WebFetchRequestSchema,
	zodToJsonSchema,
} from "./default-tools/index.js";

// =============================================================================
// Built-in Executors
// =============================================================================

export {
	type BashExecutorOptions,
	createBashExecutor,
	createDefaultExecutors,
	createEditorExecutor,
	createFileReadExecutor,
	createSearchExecutor,
	createWebFetchExecutor,
	type DefaultExecutorsOptions,
	type EditorExecutorOptions,
	type FileReadExecutorOptions,
	type SearchExecutorOptions,
	type WebFetchExecutorOptions,
} from "./default-tools/executors/index.js";

// =============================================================================
// Types
// =============================================================================

export {
	// Config Types
	type AgentConfig,
	AgentConfigSchema,
	// Event Types
	type AgentDoneEvent,
	type AgentErrorEvent,
	type AgentEvent,
	type AgentExtension,
	type AgentExtensionApi,
	type AgentExtensionBeforeAgentStartContext,
	type AgentExtensionBeforeAgentStartControl,
	type AgentExtensionCommand,
	type AgentExtensionFlag,
	type AgentExtensionInputContext,
	type AgentExtensionMessageRenderer,
	type AgentExtensionProvider,
	type AgentExtensionRegistry,
	type AgentExtensionRuntimeEventContext,
	type AgentExtensionSessionShutdownContext,
	type AgentExtensionSessionStartContext,
	type AgentExtensionShortcut,
	// Result Types
	type AgentFinishReason,
	AgentFinishReasonSchema,
	type AgentHookControl,
	type AgentHookErrorContext,
	type AgentHookIterationEndContext,
	type AgentHookIterationStartContext,
	type AgentHookRunEndContext,
	type AgentHookRunStartContext,
	type AgentHookSessionShutdownContext,
	type AgentHooks,
	type AgentHookToolCallEndContext,
	type AgentHookToolCallStartContext,
	type AgentHookTurnEndContext,
	type AgentHookTurnStartContext,
	type AgentIterationEndEvent,
	type AgentIterationStartEvent,
	type AgentReasoningEvent,
	type AgentResult,
	AgentResultSchema,
	type AgentTextEvent,
	type AgentToolCallEndEvent,
	type AgentToolCallStartEvent,
	type AgentUsage,
	type AgentUsageEvent,
	AgentUsageSchema,
	// Re-exports from providers
	type ContentBlock,
	type HookErrorMode,
	// JSON Schema
	type JsonSchema,
	type JsonSchemaProperty,
	JsonSchemaPropertySchema,
	JsonSchemaSchema,
	type Message,
	type ModelInfo,
	// Tool Types
	type PendingToolCall,
	// Internal Types (useful for extensions)
	type ProcessedTurn,
	// Reasoning
	type ReasoningEffort,
	ReasoningEffortSchema,
	type Tool,
	type ToolApprovalRequest,
	type ToolApprovalResult,
	type ToolCallRecord,
	ToolCallRecordSchema,
	type ToolContext,
	ToolContextSchema,
	type ToolDefinition,
	type ToolPolicy,
} from "./types.js";

// =============================================================================
// Re-exports from Dependencies
// =============================================================================

// Re-export commonly used types and functions from providers
export {
	type ApiHandler,
	type ApiStream,
	type ApiStreamChunk,
	createHandler,
	type ProviderConfig,
} from "@cline/llms/providers";

// Note: For model queries and information, import directly from @cline/llms/models:
// import { getModel, queryModels, getModelsForProvider } from "@cline/llms/models"
