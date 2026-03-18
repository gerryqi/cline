# Cline Custom Plugin Example

Shows how to extend `@clinebot/agents` with your own plugins. A plugin can:

- **Register tools** — give the agent new capabilities it can invoke
- **Hook into the lifecycle** — observe or influence execution at key points

Code entrypoint: [apps/examples/custom-plugin/index.ts](apps/examples/custom-plugin/index.ts)

## Run it

```bash
ANTHROPIC_API_KEY=sk-... bun run apps/examples/custom-plugin/index.ts
```

## How it works

A plugin is a plain object with three parts:

```ts
const myPlugin: Plugin = {
  // 1. Identity
  name: "my-plugin",

  // 2. Manifest — declare what the plugin does
  manifest: {
    capabilities: ["tools", "hooks"],
    hookStages: ["run_start", "run_end"], // list every hook you implement
  },

  // 3. Setup — register tools, commands, etc.
  setup(api) {
    api.registerTool(createTool({ ... }));
  },

  // 4. Hooks — observe or influence agent execution
  onRunStart({ userMessage }) { ... },
  onRunEnd({ result }) { ... },
};
```

Then pass it to the agent:

```ts
const agent = new Agent({
  ...
  extensions: [myPlugin],
});
```

## Available capabilities

| Capability         | What it unlocks                           |
| ------------------ | ----------------------------------------- |
| `tools`            | `api.registerTool()`                      |
| `commands`         | `api.registerCommand()`                   |
| `shortcuts`        | `api.registerShortcut()`                  |
| `flags`            | `api.registerFlag()`                      |
| `message_renderers`| `api.registerMessageRenderer()`           |
| `providers`        | `api.registerProvider()`                  |
| `hooks`            | lifecycle hook handlers (see below)       |

## Available hook stages

| Stage               | Handler               | When it fires                      |
| ------------------- | --------------------- | ---------------------------------- |
| `run_start`         | `onRunStart`          | before the agent starts running    |
| `run_end`           | `onRunEnd`            | after the agent finishes           |
| `iteration_start`   | `onIterationStart`    | before each LLM call               |
| `iteration_end`     | `onIterationEnd`      | after each LLM call                |
| `turn_start`        | `onTurnStart`         | before the model turn              |
| `turn_end`          | `onAgentEnd`          | after the model turn               |
| `tool_call_before`  | `onToolCall`          | before a tool executes             |
| `tool_call_after`   | `onToolResult`        | after a tool executes              |
| `before_agent_start`| `onBeforeAgentStart`  | to override system prompt/messages |
| `session_start`     | `onSessionStart`      | when a session begins              |
| `session_shutdown`  | `onSessionShutdown`   | when a session ends                |
| `input`             | `onInput`             | when the user sends input          |
| `runtime_event`     | `onRuntimeEvent`      | on every agent event               |
| `error`             | `onError`             | when an unhandled error occurs     |
