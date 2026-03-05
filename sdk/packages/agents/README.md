# @cline/agents

Package-level docs are centralized:

- Overview: [`packages/README.md`](../README.md)
- Architecture and interactions: [`packages/ARCHITECTURE.md`](../ARCHITECTURE.md)

For extended agent API details, see [`packages/agents/DOC.md`](./DOC.md).

## Conversation Restore API

`Agent` now supports first-class history restore for resume flows:

- `initialMessages` in `AgentConfig`
- `agent.restore(messages)`

Clients should use these APIs instead of mutating internal `agent.messages`.

## Team Runtime Boundary

`@cline/agents` owns in-memory team coordination/tooling only.

- Team tools emit runtime events and manage in-memory behavior.
- Persistent team state storage is handled by `@cline/core`.

## Browser-Safe Default Tooling

Node-specific default tools were moved out of `@cline/agents` into `@cline/core`.

- `@cline/agents` now only ships generic tool primitives plus `createAskQuestionTool(...)`.
- Runtime built-ins (`read_files`, `search_codebase`, `run_commands`, `fetch_web_content`, `editor`, `skills`) are provided by `@cline/core` and injected at runtime.

## Tool Call Streaming

Tool-call arguments are buffered while provider chunks stream in and are finalized
after the turn completes. This avoids executing partially streamed inputs that may
be temporarily valid JSON but not the final tool payload.
Final argument parsing now uses `parseJsonStream` from `@cline/shared` to recover
repairable JSON payloads before treating inputs as invalid.

## Shared Tool Contracts

Tool contract types and schemas are now sourced from `@cline/shared`.

- `Tool`, `ToolContext`, `ToolPolicy`, `ToolCallRecord`, `JsonSchema`
- `ToolContextSchema`, `ToolCallRecordSchema`

`@cline/agents` re-exports these through its public API for convenience.

## Client Logger Injection

`AgentConfig` now accepts an optional `logger` object (`debug` / `info` / `warn` / `error`)
typed as `BasicLogger` from `@cline/shared`.

When provided, the agent emits lifecycle logs for loop start/end, iteration progress,
tool call boundaries, and recoverable errors so host clients can trace runs without
importing internal logger services.

## Subprocess Hook Session Context

Subprocess hook payloads now support `sessionContext` so hosts can pass root session metadata explicitly (for example, root session id and hook log path) without relying on process-global env mutation.
