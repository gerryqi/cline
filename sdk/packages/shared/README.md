# @cline/shared

Package-level docs are centralized:

- Overview: [`packages/README.md`](../README.md)
- Architecture and interactions: [`packages/ARCHITECTURE.md`](../ARCHITECTURE.md)

`@cline/shared` owns shared cross-package primitives (paths/session common types/utilities), including data path resolvers such as `resolveClineDataDir`, `resolveSessionDataDir`, and `resolveTeamDataDir`.

It also exports cross-client logging contracts, including `BasicLogger`, so
runtime, SDK, and host applications can share a single logger type.

It now also exports hook session context primitives used across agents/core/CLI:

- `HookSessionContext`
- `resolveHookSessionContext(...)`
- `resolveRootSessionId(...)`
- `resolveHookLogPath(...)`

It also exports cross-client RPC runtime payload DTOs used by multiple hosts
(`@cline/cli`, `@cline/code`) so request/response contracts are not duplicated
outside transport wiring:

- chat runtime payloads (`RpcChatStartSessionRequest`, `RpcChatRunTurnRequest`, `RpcChatTurnResult`)
- provider runtime payloads (`RpcProviderActionRequest`, `RpcProviderCatalogResponse`, `RpcProviderOAuthLoginResponse`)

Chat runtime payload notes:
- `RpcChatStartSessionRequest` supports `initialMessages` and optional `toolPolicies`.
- `RpcChatRunTurnRequest` supports `promptPreformatted` for callers that already built CLI-style user input envelopes.
