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
- import llms contracts from `@cline/llms` (root only)
- do not use `@cline/llms/*` deep imports

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
- `FileTeamPersistenceStore`

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
- `hooks` in `AgentConfig` handle lifecycle callbacks and subprocess integrations

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
import { Agent, createBuiltinTools } from "@cline/agents"

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
	}),
})

const result = await agent.run("Summarize this repository.")
console.log(result.text)
```
