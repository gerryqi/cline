# Cline Desktop

`@cline/desktop` is a Tauri desktop app that wraps the tasks UI and runs real agent tasks through the CLI as subprocesses.

## What It Does

- Adds `desktop` as a Bun workspace package.
- Runs a Next.js frontend inside a Tauri webview.
- Starts agent tasks by spawning the CLI (`packages/cli/src/index.ts`) per card.
- Auto-discovers sessions started directly from CLI (outside Desktop).
- Tracks live output via streamed stdout/stderr events.
- Tracks progress via lifecycle hook events (`tool_call`, `tool_result`, `agent_end`, `session_shutdown`).
- Persists shared session registry in SQLite with optimistic status locking.

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
2. Create a new agent task from the header.
3. Click **Start** on a queued card.
4. Backend launches a new CLI subprocess with task settings.
5. Card state updates from streamed chunks + hook logs.
6. Session end transitions card to completed/failed/cancelled.

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
