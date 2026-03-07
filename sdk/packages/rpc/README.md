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
- `RunProviderAction(request_json)` - provider catalog/model/settings actions and typed Cline account actions (`action: "clineAccount"`)
- `RunProviderOAuthLogin(provider)` - provider OAuth login action

Runtime payload DTOs consumed by multiple hosts are defined in `@cline/shared`
(`packages/shared/src/rpc/runtime.ts`), while transport/service wiring remains in `@cline/rpc`.

It also exposes server lifecycle helpers:

- `getRpcServerHealth(address)` for health checks
- `requestRpcServerShutdown(address)` for remote graceful shutdown
- `registerRpcClient(address, input)` for client registration (`clientId`, `clientType`, optional metadata)
- `RpcSessionClient.publishEvent(...)` / `RpcSessionClient.streamEvents(...)` for client-side event routing
- `RpcSessionClient.requestToolApproval(...)` / `respondToolApproval(...)` / `listPendingApprovals(...)` for approval request/decision flows
- On graceful shutdown, the server broadcasts `eventType: "rpc.server.shutting_down"` to current stream subscribers before transport teardown.

## Runtime Chat Client Helpers

`@cline/rpc` also exports reusable runtime chat client helpers used by app bridge scripts:

- `RpcRuntimeChatClient` (`packages/rpc/src/runtime-chat-client.ts`)
- `runRpcRuntimeEventBridge(...)` (`packages/rpc/src/runtime-chat-stream-bridge.ts`)
- `runRpcRuntimeCommandBridge(...)` (`packages/rpc/src/runtime-chat-command-bridge.ts`)

These allow host clients (for example code/desktop apps) to share one implementation for:

- runtime chat start/send/abort calls
- session-subscription control loop for streamed chat events
- request/response envelope handling for persistent stdio runtime bridges

## Session Backend Injection

`@cline/rpc` is transport-only for session persistence. It does not own a database-backed session store.

- `startRpcServer(...)` now requires a `sessionBackend` implementation via `RpcServerOptions`.
- Session persistence contracts live in `RpcSessionBackend` / `RpcSessionRow` / `RpcSessionUpdateInput`.
- `@cline/core/server` provides a ready-to-use SQLite backend (`createSqliteRpcSessionBackend`).
- Runtime shutdown can now include host cleanup via optional `RpcRuntimeHandlers.dispose()`, which `startRpcServer(...)/stopRpcServer()` invokes during server stop.

## Build note

`@cline/rpc` is consumed by Node-based tools (for example `@cline/cli` auth commands) from compiled `dist` exports.
Run `bun -F @cline/rpc build` (or root `bun run build`) before invoking those commands from source checkouts.
