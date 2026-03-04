# @cline/rpc

`@cline/rpc` provides a gRPC gateway for routing communication between clients, sessions, tasks, spawn queues, events, and tool approvals.

## Server Lifecycle API

- `startRpcServer(options?)`
- `getRpcServerHealth(address)`
- `getRpcServerHandle()`
- `stopRpcServer()`

`startRpcServer()` is process-singleton aware:

- if already running in the same process, it returns the existing handle
- concurrent starts share one in-flight startup promise
- it does not create a second in-process server

Use `getRpcServerHealth(address)` to probe an already-running server at an address (including a server started by another process).

## Default address

- `127.0.0.1:4317`

## Client API

- `RpcSessionClient`
  - RPC-backed session CRUD and spawn-queue calls for host apps (`upsertSession`, `getSession`, `listSessions`, `updateSession`, `deleteSession`, `enqueueSpawnRequest`, `claimSpawnRequest`)

## Service methods

- `Health`
- `RegisterClient`
- `EnsureSession`
- `UpsertSession`
- `GetSession`
- `ListSessions`
- `UpdateSession`
- `DeleteSession`
- `EnqueueSpawnRequest`
- `ClaimSpawnRequest`
- `StartTask`
- `CompleteTask`
- `PublishEvent`
- `StreamEvents`
- `RequestToolApproval`
- `RespondToolApproval`
- `ListPendingApprovals`

Proto definition: `src/proto/rpc.proto`.

## Proto Type Generation

- Generate TypeScript types from the proto schema:
  - `bun run generate:proto`
- `bun run build` runs proto generation automatically before bundling.
- Generated files are written under `src/proto/generated/`.
