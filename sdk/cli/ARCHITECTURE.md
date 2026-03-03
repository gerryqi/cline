# @cline/cli Architecture

This document explains how `@cline/cli` consumes `@cline/core`, `@cline/agents`, and `@cline/llms`, with a focus on how streamed model output reaches the terminal.

## Package Role

`@cline/cli` is the executable shell around the agent runtime. It does four main jobs:

- Parse CLI input and environment into runtime config.
- Compose runtime capabilities (tools, teams, spawn support) via `@cline/core`.
- Execute agent loops via `@cline/agents`.
- Fetch model metadata and provider handlers via `@cline/llms` (indirectly through agents, directly for model catalog lookup).

## Dependency Boundaries

### `@cline/core` consumption

Primary usage in `cli/src/index.ts`:

- `DefaultRuntimeBuilder`
  - Builds runtime tool list and optional team runtime.
  - Handles team persistence bootstrap via core-owned runtime wiring.
- `createTeamName`
  - Generates team names when team mode is enabled.
- `enrichPromptWithMentions` and `prewarmFastFileList`
  - Enriches `@mentions`/file context in user prompts.
- `generateWorkspaceInfo`
  - Builds workspace metadata used to construct the default system prompt.
- `ProviderSettingsManager`
  - Loads persisted provider settings (provider/model/auth) from core-managed storage.
  - Persists the effective provider/model selection so future CLI/desktop runs reuse the same defaults.
- Session and manifest types/services (through CLI utilities)
  - CLI writes and updates session artifacts for local auditability.

### `@cline/agents` consumption

Primary usage in `cli/src/index.ts`:

- `Agent`
  - Main execution engine used for both single-shot and interactive loops.
- `createBuiltinTools`
  - CLI default tool set (read/search/bash/web-fetch).
- `createSubprocessHooks`
  - Hook bridge for tool and lifecycle events (`hook` subcommand).
- `createSpawnAgentTool`
  - Optional spawn tool for delegated/sub-agent execution.
- Agent/team event and policy types
  - `AgentEvent`, `TeamEvent`, `ToolPolicy`, tool approval contracts.

### `@cline/llms` consumption

Two paths:

- Direct in CLI:
  - `getLiveModelsCatalog()` to resolve/refresh provider model lists at startup.
- Indirect through agents:
  - `Agent` constructs a provider handler with `createHandler(...)` from `@cline/llms/providers`.
  - Streaming chunks from handlers are normalized as `ApiStreamChunk` values.

## Runtime Composition Flow

```mermaid
flowchart TD
  A[CLI args/env/stdin] --> B[Build Config]
  B --> B1[core: ProviderSettingsManager load]
  B1 --> B2[Resolve provider/model/apiKey defaults]
  B2 --> B3[core: ProviderSettingsManager save]
  B3 --> C[core: DefaultRuntimeBuilder.build]
  C --> D[tools + optional team runtime]
  D --> E[agents: new Agent]
  E --> F[agent.run or agent.continue]
```

## Streaming Path: Agent to CLI Output

The CLI does not currently consume `streamRun(...)` directly. Instead it uses `Agent` callbacks:

1. CLI constructs `new Agent({ ..., onEvent })`.
2. CLI calls `agent.run(...)` or `agent.continue(...)`.
3. Inside `Agent`, `processTurn()` iterates provider stream chunks from llms handler:
   - `for await (const chunk of handler.createMessage(...))`
4. `Agent` converts chunks into high-level `AgentEvent` callbacks:
   - `text` chunk -> emits `{ type: "text", text, accumulated }`
   - `tool_calls` chunk -> accumulates tool call payloads
   - `usage` chunk -> updates usage counters
   - `done` chunk -> final turn completion/error state
5. CLI `onEvent` handler (`handleEvent`) renders each event immediately:
   - `text` -> `process.stdout.write(event.text)` (streamed token/chunk display)
   - `tool_call_start` / `tool_call_end` -> formatted tool telemetry
   - `done` -> prints finish banner
   - `error` -> prints error line
6. After completion, CLI persists final messages and optional usage/timing summary.

### Stream Lifecycle Diagram

```mermaid
sequenceDiagram
  participant U as User
  participant CLI as @cline/cli
  participant A as @cline/agents Agent
  participant L as @cline/llms Handler

  U->>CLI: prompt
  CLI->>A: agent.run(prompt) with onEvent callback
  A->>L: createMessage(system,messages,tools)

  loop Provider stream
    L-->>A: ApiStreamChunk(text/tool_calls/usage/...)
    A-->>CLI: onEvent(AgentEvent)
    CLI->>CLI: handleEvent(event)
    CLI->>U: write streamed text/tool status
  end

  A-->>CLI: AgentResult
  CLI->>CLI: persist messages + print summary
```

## Where Streaming Is Rendered

Key rendering function in CLI:

- `handleEvent(event, config)` in `cli/src/index.ts`
  - Text streaming is the `case "text": write(event.text)` branch.
  - `write(...)` writes to stdout and also appends to transcript artifact files.

This means terminal output is event-driven and incremental, not buffered until the end.

## Single Prompt vs Interactive

Both modes use the same streaming mechanism:

- Single prompt: creates agent per run and calls `agent.run(...)`.
- Interactive mode: reuses one agent instance across turns and calls `run(...)` once, then `continue(...)` for next turns.

In both cases, streamed text appears through the same `onEvent -> handleEvent -> write` path.

## Notes on Core vs CLI Responsibilities

- Core runtime builder is responsible for capability composition (tools/team runtime lifecycle).
- Core settings manager is responsible for provider settings schema + persistence shape.
- CLI is responsible for presentation, session artifact persistence, and user I/O.
- CLI is responsible for precedence and selection policy at startup:
  - explicit CLI flags
  - persisted provider-scoped settings from core
  - built-in defaults/live catalog fallback
- Agents owns loop semantics and event emission.
- LLMS owns provider-specific streaming and normalization into unified chunks.
