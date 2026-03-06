# @cline/core

Package-level docs are centralized:

- Overview: [`packages/README.md`](../README.md)
- Architecture and interactions: [`packages/ARCHITECTURE.md`](../ARCHITECTURE.md)

`@cline/core` is the stateful orchestration layer (runtime composition, sessions, storage, RPC session adapter).

## Cline Account Service

`@cline/core` now exposes a typed Cline account service API for account/profile/credit reads and account switching:

- `ClineAccountService` for direct authenticated API usage
- `RpcClineAccountService` for typed account calls over `RunProviderAction`
- `executeRpcClineAccountAction(...)` and `isRpcClineAccountActionRequest(...)` for RPC runtime handler dispatch

This keeps account behavior in core and removes ad hoc account JSON parsing from host runtime handlers.

## RPC Session Backend

`@cline/core/server` provides the SQLite implementation for the RPC session persistence contract:

- `SqliteRpcSessionBackend`
- `createSqliteRpcSessionBackend(options?)`

Use this backend when starting `@cline/rpc` servers so RPC remains transport-only while session persistence stays owned by `@cline/core`.

## Default Runtime Tools

`@cline/core` now owns default runtime tool construction and Node executors.

- Use `createBuiltinTools(...)`, `createDefaultTools(...)`, and `createDefaultExecutors(...)` from `@cline/core` / `@cline/core/server`.
- `DefaultRuntimeBuilder` injects these tools at runtime.
- `@cline/agents` remains browser-safe and only provides the standalone `ask_question` helper tool.

## Default Session Manager

`@cline/core/server` now exposes `DefaultSessionManager`, a concrete runtime facade that owns:

- root session lifecycle + manifest/artifact wiring
- runtime/tool composition through `DefaultRuntimeBuilder`
- agent lifecycle (run/continue/abort/stop/dispose)
- session message persistence after each turn
- session status transitions and event fanout via `CoreSessionEvent`

`DefaultSessionManager.dispose(reason?)` now provides a manager-wide shutdown path that cancels and tears down all active sessions, ensuring tool/runtime resources are released on host shutdown.

This is the primary API for host clients that should only consume runtime events and outputs without manually creating agents or persisting messages.

Session persistence behavior:

- Root sessions are now persisted lazily on first user prompt submission (not at `start()` time).
- Calling `stop()`/`dispose()` before any user prompt no longer creates session records/artifacts or emits `session_shutdown` audit entries for that idle session.
- Session artifacts are stored under a single folder per concrete session id (`~/.cline/data/sessions/<sessionId>/...`) with no extra nested directories for subagent/teamtask naming.

Session message history persistence now enriches the latest assistant message of each turn with metadata before writing `messages.json`:

- `providerId` and `modelId`
- `modelInfo` (`id`, `provider`)
- `metrics` (`inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `cost`)
- `ts` (turn completion timestamp in epoch milliseconds)

## Session Host Factory

`@cline/core/server` also exposes `createSessionHost(options?)`, a higher-level host entrypoint that builds a ready-to-use session manager with backend resolution:

- supports `backendMode: "auto" | "rpc" | "local"`
- auto-detects and can auto-start RPC in `"auto"` mode
- falls back to local SQLite session storage when RPC is unavailable
- accepts runtime defaults (`defaultToolExecutors`, `toolPolicies`, `requestToolApproval`)
- accepts `sessionService` to force a specific backend instance

This is intended to be the portable client integration API for CLI/desktop/editor hosts.

## Session Context Propagation

`@cline/core` runtime/session flows now consume explicit hook payload session context (`sessionContext.rootSessionId`) for subagent/session linkage, instead of relying on process-global `CLINE_SESSION_ID` mutation in `DefaultSessionManager`.

## Hook Config Runtime Wiring

`DefaultSessionManager` now wires discovered hook config files (for example `PostToolUse`, `TaskComplete`, `TaskCancel`) into live runtime sessions.

- Hook config files are discovered from configured hook search paths and mapped to lifecycle events (`tool_call`, `tool_result`, `agent_end`, `agent_abort`, `session_shutdown`, etc.).
- Hook files execute as external commands during agent lifecycle dispatch (`tool_call` remains blocking to allow hook control responses; other events dispatch asynchronously).
- Hook execution now resolves explicit command arrays per hook file:
  - shebang present: uses shebang interpreter + script path
  - no shebang: uses interpreter fallback by extension (`.sh` -> `bash`, `.js` -> `node`, `.ts` -> `bun run`) and defaults to `bash` for legacy extensionless files
- This avoids direct file spawning failures like `EACCES` on non-executable hook files.
- When no explicit host-provided runtime hooks are configured, core now writes baseline hook lifecycle audit entries to the session `*.hooks.jsonl` artifact so hosts can display real execution status.

## Runtime Logger Forwarding

`CoreSessionConfig` now supports an optional `logger`. `DefaultRuntimeBuilder` forwards
this logger through the built runtime, and `DefaultSessionManager` passes it into root
agents and spawned sub-agents, so host clients can capture agent-loop trace logs in one place.

## Team State Persistence Boundary

Team state file persistence (`state.json` and `task-history.jsonl`) is owned by `@cline/core` session services/runtime wiring.

`@cline/agents` team tooling emits in-memory runtime events only; `@cline/core` consumes those events and performs filesystem persistence.

## OAuth Callback Behavior

For `openai-codex` CLI login, the local callback server now binds to the same host/port/path as the configured redirect URI (`OPENAI_CODEX_OAUTH_CONFIG.redirectUri`) to avoid localhost/127.0.0.1 mismatches on some systems.

For `oca` CLI login, default callback ports are `48801-48811` (`/auth/oca`) to match existing IDCS redirect URI allowlists used by the legacy flow.

## OAuth Client Callback Helper

`@cline/core/server` exports `createOAuthClientCallbacks(...)` so host clients can share OAuth UX wiring while keeping client-specific browser behavior:

- `onOutput(message)` receives auth instructions and URL text
- `openUrl(url)` is optional and lets each client decide how to launch URLs (CLI, desktop, editor integrations, etc.)
- `onOpenUrlError(...)` handles browser-launch failures without breaking login

## Runtime OAuth Refresh

`DefaultSessionManager` now owns OAuth access-token refresh for managed OAuth providers (`cline`, `oca`, `openai-codex`) so host clients do not need to call refresh helpers directly.

- Before each turn, core resolves provider settings and refreshes tokens when they are expired or near expiry.
- Refresh results are persisted back to provider settings (`auth.accessToken`, `auth.refreshToken`, `auth.accountId`, `auth.expiresAt`).
- Refresh operations are single-flight per provider to avoid concurrent refresh storms in long-lived RPC runtimes.
- When a turn fails with an auth-like error (for example HTTP 401/403), core force-refreshes once and retries the turn once.

## MCP Settings Compatibility

`@cline/core` loads MCP registrations from `cline_mcp_settings.json` and supports both shapes:

- Preferred nested transport:
  - `{ "mcpServers": { "docs": { "transport": { "type": "stdio", "command": "node" } } } }`
- Legacy flat transport (still accepted):
  - `{ "mcpServers": { "docs": { "command": "node" } } }`
  - `{ "mcpServers": { "remote": { "url": "https://mcp.example.com", "transportType": "http" } } }`

Legacy `transportType: "http"` is normalized to `transport.type: "streamableHttp"`.

## Provider Settings Migration Helper

`@cline/core` exposes `migrateLegacyProviderSettings(...)` to bootstrap the new provider settings file from legacy state storage:

- Reads legacy files from `~/.cline/data/globalState.json` and `~/.cline/data/secrets.json` (or `CLINE_DATA_DIR`)
- Merges missing providers into `settings/providers.json` without overwriting existing providers
- Marks migrated provider entries with `tokenSource: "migration"`

## Desktop Tool Approval Helper

`@cline/core` includes a shared file-IPC helper for desktop tool approvals:

- `requestDesktopToolApproval(request, options?)`
- Writes `*.request.*.json` records and polls for matching `*.decision.*.json` responses
- Used by CLI and desktop app runner scripts to avoid duplicated approval protocol logic
- `options.approvalDir` and `options.sessionId` are now explicit inputs (no env fallback in core runtime helper)

## Fast File Indexing

`@cline/core/input` now runs fast file indexing in a dedicated Node worker thread.

- `getFileIndex(cwd, options?)` keeps the same API (`Promise<Set<string>>`) and TTL caching semantics.
- Index builds (ripgrep scan + filesystem fallback walk) execute off the main thread to reduce prompt-path latency spikes.
- `prewarmFileIndex(cwd, options?)` still forces a rebuild and refreshes the cached set for subsequent reads.
- Unit tests for index consumption paths (`file-indexer`, `mention-enricher`) mock `node:worker_threads` and assert index behavior independent of worker scheduling.

## Type Validation Notes

- Provider settings storage schemas use explicit Zod v4 record key/value signatures (`z.record(z.string(), valueSchema)`).

## Testing

Run tests from the workspace root:

- Unit tests: `bun -F @cline/core test:unit`
- E2E tests: `bun -F @cline/core test:e2e`
- Full suite: `bun -F @cline/core test`
