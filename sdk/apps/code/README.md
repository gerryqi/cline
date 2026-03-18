# @clinebot/code

Tauri desktop host + Next.js UI for running and inspecting Cline chat sessions.

## Dev Commands

From `apps/code/`:

- `bun run dev:web` - Next.js UI only (`http://localhost:3125`)
- `bun run dev` - Tauri desktop dev
- `bun run build` - build web assets
- `bun run build:binary` - build desktop binary
- `bun run typecheck` - TypeScript check

## Runtime Overview

Startup flow:

1. Tauri ensures an RPC server via `clite rpc ensure --json`.
2. It sets `CLINE_RPC_ADDRESS` and registers the desktop client (`clite rpc register`).
3. It starts a local WebSocket chat bridge (`/chat`) and exposes the endpoint to the UI.
4. The UI keeps one persistent socket and sends chat commands (`start`, `send`, `abort`, `reset`) over that connection.
5. If websocket command/response transport is unavailable during a turn, the UI falls back to the direct Tauri command path (`chat_session_command`) so requests are still delivered.
6. Host/runtime communication is handled by `scripts/chat-runtime-bridge.ts` using `@clinebot/core` RPC bridge helper re-exports.
7. Session process context resolves `workspaceRoot` from git root and uses that same path as default `cwd` for chat runtime and git operations unless explicitly overridden.

Chat transport envelope:

- Request: `{ "requestId": string, "request": ChatSessionCommandRequest }`
- Response: `{ "type": "chat_response", "requestId": string, "response"?: ChatSessionCommandResponse, "error"?: string }`
- Stream event: `{ "type": "chat_event", "event": StreamChunkEvent }`

## Settings: Routine

- The Settings sidebar includes a `Routine` view for scheduler-backed automations.
- `Routine` lists all RPC schedules and shows status (`enabled`, `nextRunAt`, active execution).
- From the UI you can open a create form and add, pause/resume, trigger-now, and delete schedules.
- The view is wired to the same scheduler APIs used by `clite schedule` through Tauri commands and `scripts/routine-schedules.ts`.

## Key Files

- [`src-tauri/src/main.rs`](/Users/beatrix/dev/clinee/sdk-wip/apps/code/src-tauri/src/main.rs) - Tauri host lifecycle and command handling
- [`scripts/chat-runtime-bridge.ts`](/Users/beatrix/dev/clinee/sdk-wip/apps/code/scripts/chat-runtime-bridge.ts) - persistent RPC runtime bridge
- [`scripts/routine-schedules.ts`](/Users/beatrix/dev/clinee/sdk-wip/apps/code/scripts/routine-schedules.ts) - RPC scheduler action bridge for Settings > Routine
- [`hooks/use-chat-session.ts`](/Users/beatrix/dev/clinee/sdk-wip/apps/code/hooks/use-chat-session.ts) - UI chat session state + websocket transport
- [`lib/chat-schema.ts`](/Users/beatrix/dev/clinee/sdk-wip/apps/code/lib/chat-schema.ts) - chat message schema used by the UI
- [`components/views/settings/routine-view.tsx`](/Users/beatrix/dev/clinee/sdk-wip/apps/code/components/views/settings/routine-view.tsx) - Routine schedules UI

## Data + Storage

- Session artifacts are written under `~/.cline/data/sessions/<sessionId>/` (or `CLINE_SESSION_DATA_DIR`).
- Core files include `<sessionId>.messages.json`, `<sessionId>.hooks.jsonl`, and `<sessionId>.log`.

## Troubleshooting

- If live updates stall, verify the UI websocket is connected and `chat_event` messages are arriving.
- Websocket request/response calls now time out after 120s; if a command appears stuck, check for `Chat request timed out waiting for websocket response` in UI errors or console and retry.
- Runtime bridge `send` calls are now bounded to 120s by default (`CLINE_RPC_RUNTIME_SEND_TIMEOUT_MS`). This prevents one hung turn from wedging the persistent bridge loop for all future chat requests.
- The Tauri host also bounds bridge command waits to 130s (`chat runtime bridge request timed out`), so stalled bridge requests now fail explicitly instead of leaving chat in perpetual `running`.
- Chat sends now preflight provider credentials. If a provider that requires API-key auth is selected without a key, the UI blocks the turn with a clear error message instead of starting a hanging session.
- If a turn completes with `finishReason=error` before any assistant content is produced, the UI now adds an explicit error chat message so failed turns are visible in the transcript.
- If package changes are not reflected, rebuild SDK packages (`bun run build:sdk`) and restart the RPC server.
- Provider settings updates are patch-style: only fields you edit are changed. Unset fields are preserved instead of being cleared.
