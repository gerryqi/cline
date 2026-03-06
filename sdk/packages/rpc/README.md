# @cline/rpc

Package-level docs are centralized:

- Overview: [`packages/README.md`](../README.md)
- Architecture and interactions: [`packages/ARCHITECTURE.md`](../ARCHITECTURE.md)

`@cline/rpc` provides transport/control-plane APIs for sessions, tasks, events, spawn queues, and tool approvals.
It also exposes runtime session execution RPCs:

- `StartRuntimeSession(request_json)` - create/start a server-side runtime session
- `StartRuntimeSession` returns `session_id` and optional serialized session start metadata (`start_result_json`)
- `SendRuntimeSession(session_id, request_json)` - execute a prompt turn on that runtime session
- `AbortRuntimeSession(session_id)` - request cancellation for an active runtime session turn
- `PublishEvent(...)` / `StreamEvents(...)` - publish and subscribe to routed events
- `RunProviderAction(request_json)` - provider catalog/model/settings actions
- `RunProviderOAuthLogin(provider)` - provider OAuth login action

Runtime payload DTOs consumed by multiple hosts are defined in `@cline/shared`
(`packages/shared/src/rpc/runtime.ts`), while transport/service wiring remains in `@cline/rpc`.

It also exposes server lifecycle helpers:

- `getRpcServerHealth(address)` for health checks
- `requestRpcServerShutdown(address)` for remote graceful shutdown
- `registerRpcClient(address, input)` for client registration (`clientId`, `clientType`, optional metadata)
- `RpcSessionClient.publishEvent(...)` / `RpcSessionClient.streamEvents(...)` for client-side event routing

## Session Backend Injection

`@cline/rpc` is transport-only for session persistence. It does not own a database-backed session store.

- `startRpcServer(...)` now requires a `sessionBackend` implementation via `RpcServerOptions`.
- Session persistence contracts live in `RpcSessionBackend` / `RpcSessionRow` / `RpcSessionUpdateInput`.
- `@cline/core/server` provides a ready-to-use SQLite backend (`createSqliteRpcSessionBackend`).

## Build note

`@cline/rpc` is consumed by Node-based tools (for example `@cline/cli` auth commands) from compiled `dist` exports.
Run `bun -F @cline/rpc build` (or root `bun run build`) before invoking those commands from source checkouts.
