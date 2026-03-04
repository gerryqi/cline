# Architecture

## Overview

The desktop app is split into three layers:

1. **Frontend (Next.js)**: Kanban board UI and user interactions.
2. **Desktop Runtime (Tauri/Rust)**: process orchestration and event bridge.
3. **Execution Engine (CLI + Agents)**: actual agent/task execution with hooks.

Boundary note:
- SDK imports are root-only (`@cline/llms`, `@cline/agents`, `@cline/core`)
- Node-only core services remain scoped to `@cline/core/server` in runtime hosts

## Layer Details

### 1) Frontend

Primary file: `desktop/components/kanban-board.tsx`

Responsibilities:

- Manage card lifecycle (`queued -> running -> completed|failed|cancelled`).
- Send `start_session` and `stop_session` commands to Tauri.
- Listen for runtime events:
  - `agent://chunk`
  - `agent://session-ended`
- Poll commands for process + hook state:
  - `poll_sessions`
  - `read_session_hooks`

### 2) Tauri Backend

Primary file: `desktop/src-tauri/src/main.rs`

Responsibilities:

- Spawn one CLI subprocess per session/card.
- Stream stdout/stderr as chunk events to frontend.
- Persist transcript + hook logs per session.
- Expose commands to webview:
  - `start_session`
  - `send_prompt`
  - `stop_session`
  - `abort_session`
  - `poll_sessions`
  - `read_session_hooks`
  - team state/history helpers

### 3) CLI + Agents

Primary file: `cli/src/index.ts`

Responsibilities:

- Run agent loop (interactive/single prompt modes).
- Enable tools/spawn/team runtime per session config.
- Attach `createSubprocessHooks(...)` when enabled.
- Handle `agent hook` payloads and append structured hook logs.
- Persist session registry + metadata in SQLite (`sessions.db`).
- Write transcript and hook files under per-session directories for tail/read operations.
- Expose `agent sessions list` for desktop discovery.

## Session Registry (SQLite)

Location:

- `~/.cline/data/sessions/sessions.db` (or `CLINE_SESSION_DATA_DIR`)

Key table:

- `sessions`
: includes `session_id`, `status`, `status_lock`, `pid`, `provider`, `model`, `cwd`, `prompt`, file paths, timestamps.

## Status Lock Strategy

To reduce race conditions between concurrent writers (runtime updates, exit handlers), status updates use optimistic locking:

1. Read `status_lock` for a session row.
2. `UPDATE ... WHERE session_id = ? AND status_lock = ?`
3. Increment `status_lock` on success.
4. Retry a few times if lock value changed.

This guarantees only one writer can commit a specific status transition at a given lock version.

## Session Lifecycle

1. User creates card in UI.
2. UI sends `start_session` with model/provider/task settings.
3. Tauri launches CLI with:
   - `CLINE_ENABLE_SUBPROCESS_HOOKS=1`
   - `CLINE_HOOKS_LOG_PATH=<session hook log path>`
4. CLI runs task and emits output + hook events.
5. CLI stores session state in SQLite and updates status with lock checks.
6. Tauri relays output chunks for app-managed sessions and also polls `agent sessions list` for external sessions.
7. UI imports unknown sessions as cards, updates progress from hook/transcript polling, and finalizes status from registry/process events.

## Why This Design

- **Isolation**: each card has an independent process.
- **Recoverability**: transcript/hook JSONL files preserve runtime history.
- **Observable progress**: hooks provide structured progress beyond raw console text.
- **Extensible**: Tauri command layer can add pause/resume/retry without changing UI contract.
