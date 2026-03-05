# @cline/core

Package-level docs are centralized:

- Overview: [`packages/README.md`](../README.md)
- Architecture and interactions: [`packages/ARCHITECTURE.md`](../ARCHITECTURE.md)

`@cline/core` is the stateful orchestration layer (runtime composition, sessions, storage, RPC session adapter).

## Default Session Manager

`@cline/core/server` now exposes `DefaultSessionManager`, a concrete runtime facade that owns:

- root session creation + manifest/artifact wiring
- runtime/tool composition through `DefaultRuntimeBuilder`
- agent lifecycle (run/continue/abort/stop)
- session message persistence after each turn
- session status transitions and event fanout via `CoreSessionEvent`

This is the primary API for host clients that should only consume runtime events and outputs without manually creating agents or persisting messages.

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

## Type Validation Notes

- Provider settings storage schemas use explicit Zod v4 record key/value signatures (`z.record(z.string(), valueSchema)`).
