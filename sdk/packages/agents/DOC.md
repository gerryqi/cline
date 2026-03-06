# @cline/agents DOC

API reference and package boundary notes for `@cline/agents`.

## Scope

`@cline/agents` owns runtime primitives:

- Agent loop execution (`Agent`)
- Tool primitives (definition, validation, execution helpers)
- Runtime interception (extensions + hooks)
- Team primitives (sub-agents, mission/task coordination)
- Streaming/event helpers

`@cline/agents` does not own stateful app orchestration. Use `@cline/core` for persistent sessions, runtime assembly, and storage.

Workspace boundary note:
- import llms contracts from `@cline/llms/node` (or `@cline/llms/browser` for browser hosts)
- do not use other `@cline/llms/*` deep imports

## Primary Exports

### Core Agent

- `Agent`
- `createAgent`

### Extensions

- `AgentExtensionRunner`
- `createExtensionRunner`
- `discoverExtensionModules`
- `loadExtensionModule`
- `loadExtensionsFromPaths`

### Hooks

- Core lifecycle engine exports (`HookEngine`, `HookHandler`) from `@cline/agents`
- Node-only subprocess hook helpers from `@cline/agents/node`:
  - `createSubprocessHooks`
  - `runHook`
  - `HookEventName`
  - `HookEventPayload`
  - `ToolCallHookPayload`
  - `ToolResultHookPayload`
  - `AgentEndHookPayload`
  - `SessionShutdownHookPayload`

### Tools

- `createTool`
- `createToolRegistry`
- `executeTool`
- `executeToolWithRetry`
- `executeToolsSequentially`
- `executeToolsInParallel`
- `validateToolDefinition`
- `validateToolInput`
- `toToolDefinition`
- `toToolDefinitions`

### Teams

- `AgentTeamsRuntime`
- `bootstrapAgentTeams`
- `createAgentTeamsTools`
- `createSpawnAgentTool`
- `createAgentTeam`
- `createWorkerReviewerTeam`

#### Team Tool Surface

`createAgentTeamsTools` provides grouped team tools with action-based inputs:

- `team_member` with `action: "spawn" | "shutdown"`
- `team_task` with `action: "create" | "claim" | "complete" | "block"`
- `team_message` with `action: "send" | "broadcast" | "read"`
- `team_status`
- `team_run_task`
- `team_list_runs`
- `team_await_run`
- `team_log_update`
- `team_cleanup`

### Streaming

- `streamRun`
- `streamContinue`
- `streamText`
- `batchEvents`
- `collectEvents`
- `filterEvents`
- `mapEvents`

### Default Tools

- `createBuiltinTools`
- `createDefaultTools`
- `createDefaultToolsWithPreset`
- `createReadFilesTool`
- `createSearchTool`
- `createBashTool`
- `createEditorTool`
- `createWebFetchTool`

## Extensions vs Hooks

- `extensions` in `AgentConfig` handle policy/plugin composition
- `setup(api)` registers runtime additions (tools, commands, shortcuts, flags, renderers, providers)
- `hooks` in `AgentConfig` handle lifecycle callbacks
- subprocess hook integrations are provided by `@cline/agents/node` or upstream runtime layers (for example `@cline/core`)

Control fields returned by extension/hook handlers:

- `cancel: boolean` to abort execution
- `context: string` to append model-visible control context
- `overrideInput: unknown` to rewrite active user input

## Migration Notes

When splitting responsibilities:

- Keep `Agent`, tools, hooks/extensions, and team runtime code in `@cline/agents`
- Move session managers, storage-backed lifecycle handling, and runtime composition into `@cline/core`
- Depend on `@cline/core` from app hosts (CLI/desktop), and depend on `@cline/agents` for runtime primitives

## Minimal Runtime Example

```ts
import { Agent, createBuiltinTools } from "@cline/agents/node"

const agent = new Agent({
	providerId: "anthropic",
	modelId: "claude-sonnet-4-5-20250929",
	apiKey: process.env.ANTHROPIC_API_KEY,
	systemPrompt: "You are a coding assistant.",
	tools: createBuiltinTools({
		cwd: process.cwd(),
		enableReadFiles: true,
		enableSearch: true,
		enableBash: true,
		enableWebFetch: true,
		enableEditor: true,
		enableSkills: true,
		enableAskQuestion: true,
	}),
})

const result = await agent.run("Summarize this repository.")
console.log(result.text)
```
