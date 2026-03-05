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
