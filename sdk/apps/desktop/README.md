# Cline Desktop

`@cline/desktop` is a Tauri desktop app that wraps the tasks UI and uses the shared RPC runtime for chat plus CLI subprocesses for task cards.

## What It Does

- Adds `desktop` as a Bun workspace package.
- Runs a Next.js frontend inside a Tauri webview.
- Starts agent tasks by spawning the CLI (`packages/cli/src/index.ts`) per card.
- Boots RPC on startup via `clite rpc ensure` + `clite rpc register`.
- Runs chat through RPC runtime methods (`startRuntimeSession`, `sendRuntimeSession`, `abortRuntimeSession`).
- Streams chat runtime events over one persistent websocket envelope (`chat_event` / `chat_response`).
- Reuses shared `@cline/rpc` runtime chat helpers for desktop/code bridge scripts:
  - [`packages/rpc/src/runtime-chat-client.ts`](/Users/beatrix/dev/clinee/sdk-wip/packages/rpc/src/runtime-chat-client.ts)
  - [`packages/rpc/src/runtime-chat-command-bridge.ts`](/Users/beatrix/dev/clinee/sdk-wip/packages/rpc/src/runtime-chat-command-bridge.ts)
  - [`packages/rpc/src/runtime-chat-stream-bridge.ts`](/Users/beatrix/dev/clinee/sdk-wip/packages/rpc/src/runtime-chat-stream-bridge.ts)
  - [`apps/desktop/scripts/chat-runtime-bridge.ts`](/Users/beatrix/dev/clinee/sdk-wip/apps/desktop/scripts/chat-runtime-bridge.ts)
- Auto-discovers sessions started directly from CLI (outside Desktop).
- Uses persisted prompt data (and falls back to the first user message) for discovered session card titles.
- Tracks live output via streamed stdout/stderr events.
- Tracks progress via lifecycle hook events (`tool_call`, `tool_result`, `agent_end`, `session_shutdown`).
- Persists shared session registry in SQLite with optimistic status locking.

## SDK Import Boundary

Desktop should use explicit runtime imports:

- Frontend/browser modules: `@cline/llms/browser`
- Node runtime modules (CLI/Tauri/scripts): `@cline/llms/node`, `@cline/agents/node`, `@cline/core/node`, `@cline/core/server/node`, `@cline/rpc/node`

## Scripts

From `packages/desktop`:

- `bun run dev:web` starts the frontend only on `http://localhost:3124`.
- `bun run dev` starts Tauri desktop dev mode.
- `bun run build` builds the frontend.
- `bun run tauri:build` builds the desktop app bundle.
- `bun run typecheck` runs TypeScript checks.

From repository root (`packages`):

- `bun run dev:desktop`
- `bun run build:desktop`

## Basic Flow

1. Open desktop app.
2. Tauri ensures/registers RPC and starts the local chat websocket bridge.
3. Chat UI opens one websocket (`get_chat_ws_endpoint`) and sends command envelopes (`start/send/abort/reset`).
4. Tauri proxies chat commands to one persistent RPC runtime bridge script and forwards stream events.
5. Task cards still run as CLI subprocesses for long-running task orchestration.
6. Card state updates from streamed chunks + hook logs and session end transitions.

## Environment

The app resolves API keys from either:

- explicit key entered in UI, or
- `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` in environment.

## Data Paths

- Session transcript chunks: `~/.cline/apps/desktop/sessions/<session-id>.jsonl`
- Session hook logs: `~/.cline/apps/desktop/hooks/<session-id>.jsonl`
- Shared CLI session data root: `~/.cline/data/sessions/`
- Shared CLI DB: `~/.cline/data/sessions/sessions.db`
- Root session artifacts:
  - `~/.cline/data/sessions/<main-session-id>/<main-session-id>.log`
  - `~/.cline/data/sessions/<main-session-id>/<main-session-id>.hooks.jsonl`
  - `~/.cline/data/sessions/<main-session-id>/<main-session-id>.messages.json`
  - `~/.cline/data/sessions/<main-session-id>/<main-session-id>.json`
- Subagent artifacts (non-teamtask):
  - `~/.cline/data/sessions/<main-session-id>/<subagent-name>/<sub-session-id>.log`
  - `~/.cline/data/sessions/<main-session-id>/<subagent-name>/<sub-session-id>.hooks.jsonl`
  - `~/.cline/data/sessions/<main-session-id>/<subagent-name>/<sub-session-id>.messages.json`
- Teamtask session + nested subagents:
  - teamtask session: `~/.cline/data/sessions/<main-session-id>/teamtask-<teamtask-id>/<teamtask-agent>/<teamtask-session-id>.log`
  - teamtask subagent: `~/.cline/data/sessions/<main-session-id>/teamtask-<teamtask-id>/<subagent-name>/<sub-session-id>.log`
- Team state/history: `~/.cline/data/teams/<team-name>/...`
