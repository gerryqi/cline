# @cline/rpc

Package-level docs are centralized:

- Overview: [`packages/README.md`](../README.md)
- Architecture and interactions: [`packages/ARCHITECTURE.md`](../ARCHITECTURE.md)

`@cline/rpc` provides transport/control-plane APIs for sessions, tasks, events, spawn queues, and tool approvals.

It also exposes server lifecycle helpers:

- `getRpcServerHealth(address)` for health checks
- `requestRpcServerShutdown(address)` for remote graceful shutdown

## Session Backend Injection

`@cline/rpc` is transport-only for session persistence. It does not own a database-backed session store.

- `startRpcServer(...)` now requires a `sessionBackend` implementation via `RpcServerOptions`.
- Session persistence contracts live in `RpcSessionBackend` / `RpcSessionRow` / `RpcSessionUpdateInput`.
- `@cline/core/server` provides a ready-to-use SQLite backend (`createSqliteRpcSessionBackend`).

## Build note

`@cline/rpc` is consumed by Node-based tools (for example `@cline/cli` auth commands) from compiled `dist` exports.
Run `bun -F @cline/rpc build` (or root `bun run build`) before invoking those commands from source checkouts.
