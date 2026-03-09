# @cline/code

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
5. Host/runtime communication is handled by `scripts/chat-runtime-bridge.ts` using shared `@cline/rpc` bridge helpers.

Chat transport envelope:

- Request: `{ "requestId": string, "request": ChatSessionCommandRequest }`
- Response: `{ "type": "chat_response", "requestId": string, "response"?: ChatSessionCommandResponse, "error"?: string }`
- Stream event: `{ "type": "chat_event", "event": StreamChunkEvent }`

## Key Files

- [`src-tauri/src/main.rs`](/Users/beatrix/dev/clinee/sdk-wip/apps/code/src-tauri/src/main.rs) - Tauri host lifecycle and command handling
- [`scripts/chat-runtime-bridge.ts`](/Users/beatrix/dev/clinee/sdk-wip/apps/code/scripts/chat-runtime-bridge.ts) - persistent RPC runtime bridge
- [`hooks/use-chat-session.ts`](/Users/beatrix/dev/clinee/sdk-wip/apps/code/hooks/use-chat-session.ts) - UI chat session state + websocket transport
- [`lib/chat-schema.ts`](/Users/beatrix/dev/clinee/sdk-wip/apps/code/lib/chat-schema.ts) - chat message schema used by the UI

## Data + Storage

- Session artifacts are written under `~/.cline/data/sessions/<sessionId>/` (or `CLINE_SESSION_DATA_DIR`).
- Core files include `<sessionId>.messages.json`, `<sessionId>.hooks.jsonl`, and `<sessionId>.log`.

## Troubleshooting

- If live updates stall, verify the UI websocket is connected and `chat_event` messages are arriving.
- If package changes are not reflected, rebuild SDK packages (`bun run build:sdk`) and restart the RPC server.
- Provider settings updates are patch-style: only fields you edit are changed. Unset fields are preserved instead of being cleared.
