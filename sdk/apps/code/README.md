# @cline/code

Tauri desktop app with a Next.js UI for running and inspecting Cline chat sessions.

## Dev Commands

From `apps/code/`:

- `bun run dev:web` - Next.js UI only (`http://localhost:3125`)
- `bun run dev` - Tauri desktop dev
- `bun run build` - build web assets
- `bun run build:binary` - build desktop binary
- `bun run typecheck` - TypeScript check

## Chat Message Exchange Lifecycle

This section explains how one chat turn moves through the app and why messages can appear either live or after hydration.

### 1) Session Start (Frontend -> Tauri)

- UI state lives in [`use-chat-session.ts`](/Users/beatrix/dev/clinee/sdk-wip/apps/code/hooks/use-chat-session.ts).
- Starting a session calls Tauri command `chat_session_command` with `action: "start"`.
- Tauri creates a runtime session in memory and returns `sessionId`.
- Tauri now ensures `config.sessions.homeDir` is present (derived from the host home dir when missing). Both session runners use it to call `setHomeDir(...)` before creating stores/artifacts, so session history resolves under the intended home directory.

Key path:
- [`use-chat-session.ts`](/Users/beatrix/dev/clinee/sdk-wip/apps/code/hooks/use-chat-session.ts)
- [`main.rs`](/Users/beatrix/dev/clinee/sdk-wip/apps/code/src-tauri/src/main.rs) (`chat_session_command`)

### 2) Send Prompt (Frontend -> Tauri)

- `sendPrompt(...)` appends a local user message immediately for optimistic UI.
- It also creates an assistant placeholder message for streaming text.
- Then it calls `chat_session_command` with `action: "send"`.

### 3) Run Turn Script (Tauri -> Node Runner)

- Tauri spawns [`scripts/chat-agent-turn.ts`](/Users/beatrix/dev/clinee/sdk-wip/apps/code/scripts/chat-agent-turn.ts).
- The script streams JSON lines back to Tauri:
  - `type: "chunk"`, `stream: "chat_text" | "chat_core_log"`
  - `type: "tool_call_start"`
  - `type: "tool_call_end"`
  - `type: "result"`

### 4) Live Stream Events (Tauri -> Frontend)

- Tauri emits each stream line via `app.emit("agent://chunk", payload)`.
- Frontend listens with `listen("agent://chunk", ...)` and updates messages live:
  - `chat_text` -> append to active assistant message
  - `chat_tool_call_start` -> add `role: "tool"` message
  - `chat_tool_call_end` -> update that tool message

Important behavior:
- If no active assistant message exists (for example after hydration), incoming `chat_text` now creates one automatically before appending. This keeps live updates working in reopened sessions.

### 5) Turn Completion + Persistence

- On successful `send`, Tauri stores `result.messages` in memory and writes disk artifacts:
  - `messages.json`
  - `hooks.jsonl`
  - `log`
- `messages.json` is the canonical structured transcript used for later hydration.

Session artifact naming:
- `<sessionId>.messages.json`
- `<sessionId>.hooks.jsonl`
- `<sessionId>.log`

Under:
- `~/.cline/data/sessions/<sessionId>/...` (or `CLINE_SESSION_DATA_DIR` if set)

### 6) Reopen/Hydrate From Sidebar

- Selecting a prior session triggers `read_session_messages` in Tauri.
- Tauri hydrates stored content blocks into UI-friendly `ChatMessage[]`:
  - text blocks -> `role: "user" | "assistant"` messages
  - `tool_use`/`tool_result` blocks -> `role: "tool"` messages
- Tool use/result are correlated by `tool_use_id` where available.

### Sidebar Status + Title Hydration

- [`agent-sidebar.tsx`](/Users/beatrix/dev/clinee/sdk-wip/apps/code/components/agent-sidebar.tsx) does a second-pass hydration for recent sessions by reading session messages.
- Sidebar history is deduplicated by `sessionId` across CLI/chat discovery results before rendering.
- Sidebar ordering is deterministic: newest session first, sorted by `startedAt` descending (not by last update time).
- Session titles are derived from the first non-empty user message, with assistant text as fallback.
- Status is refined from hydrated message content:
  - if discovered status is `failed` but the last meaningful message is from `assistant`, sidebar treats it as `completed`
  - if a session has no meaningful user/assistant message content, it is treated as `idle` (not `completed`)
- Refined status is also propagated into in-memory `sessions` state so reopened history sessions keep header/sidebar status in sync.

### 7) Render in Chat UI

- [`chat-messages.tsx`](/Users/beatrix/dev/clinee/sdk-wip/apps/code/components/chat-messages.tsx) renders:
  - user/assistant/system/status/error bubbles
  - tool messages via `ToolMessageBlock`
- Tool bubbles display:
  - compact summary (action label)
  - expandable `Input` and `Result` payload sections
  - support for result payloads that are JSON strings

## Message Shapes (UI)

UI messages follow [`ChatMessageSchema`](/Users/beatrix/dev/clinee/sdk-wip/apps/code/lib/chat-schema.ts):

- `id: string`
- `sessionId: string | null`
- `role: "user" | "assistant" | "tool" | "system" | "status" | "error"`
- `content: string`
- `createdAt: number`
- optional `meta` (`toolName`, `hookEventName`, tokens, etc.)

For tool messages, `content` is typically serialized JSON:

```json
{
  "toolName": "run_commands",
  "input": {"commands": ["pwd"]},
  "result": {"success": true, "output": "..."},
  "isError": false
}
```

## Troubleshooting

If messages show after restart but not live:

1. Verify `agent://chunk` events are received in `use-chat-session.ts` listener.
2. Verify `payload.sessionId` matches active session.
3. Verify `chat_text` creates/uses an assistant message ID before append.
4. Verify runner output lines are valid JSON (`chat-agent-turn.ts`).
5. Verify Tauri emits chunk types (`chat_text`, `chat_tool_call_start`, `chat_tool_call_end`).

If tool calls are present but not visible:

1. Check hydrated message role is `tool`.
2. Check `content` is parseable JSON payload (or expected fallback format).
3. Expand the tool row to inspect `Input`/`Result`.
