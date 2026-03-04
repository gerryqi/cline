# @cline/rpc

Package-level docs are centralized:

- Overview: [`packages/README.md`](../README.md)
- Architecture and interactions: [`packages/ARCHITECTURE.md`](../ARCHITECTURE.md)

`@cline/rpc` provides transport/control-plane APIs for sessions, tasks, events, spawn queues, and tool approvals.

## Build note

`@cline/rpc` is consumed by Node-based tools (for example `@cline/cli` auth commands) from compiled `dist` exports.
Run `bun -F @cline/rpc build` (or root `bun run build`) before invoking those commands from source checkouts.
