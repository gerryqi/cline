# @cline/cli — Complete Command & Feature Documentation

> **Package:** `@cline/cli` · **Binary:** `agent` · **Version:** 0.1.0  
> **Runtime:** [Bun](https://bun.sh) · **Language:** TypeScript (ESM)  
> **License:** Apache-2.0

---

## Table of Contents

- [@cline/cli — Complete Command \& Feature Documentation](#clinecli--complete-command--feature-documentation)
  - [Table of Contents](#table-of-contents)
  - [Overview](#overview)
  - [Installation \& Build](#installation--build)
  - [CLI Entry Point \& Argument Parsing](#cli-entry-point--argument-parsing)
    - [Argument Parser (`parseArgs`)](#argument-parser-parseargs)
  - [Commands \& Subcommands](#commands--subcommands)
    - [1. Single-Shot Mode](#1-single-shot-mode)
    - [2. Interactive Mode (`-i`)](#2-interactive-mode--i)
    - [3. Pipe / Stdin Mode](#3-pipe--stdin-mode)
    - [4. Hook Subcommand](#4-hook-subcommand)
    - [5. Sessions Subcommand](#5-sessions-subcommand)
      - [`sessions list`](#sessions-list)
      - [`sessions delete <id>`](#sessions-delete-id)
  - [All Flags \& Options](#all-flags--options)
  - [Features In Depth](#features-in-depth)
    - [Streaming Output \& Event Handling](#streaming-output--event-handling)
    - [Tools System](#tools-system)
      - [Tool Approval Policies](#tool-approval-policies)
      - [How User Approval Works in CLI](#how-user-approval-works-in-cli)
    - [Sub-Agent Spawning (`--spawn`)](#sub-agent-spawning---spawn)
    - [Agent Teams (`--teams`)](#agent-teams---teams)
    - [Session Management](#session-management)
      - [Session Lifecycle](#session-lifecycle)
      - [Session ID](#session-id)
      - [Session Status](#session-status)
      - [Session Manifest (`<sessionId>/<sessionId>.json`)](#session-manifest-sessionidsessionidjson)
      - [Sub-Session IDs](#sub-session-ids)
      - [Message Persistence](#message-persistence)
    - [Hook System](#hook-system)
      - [How Hooks Are Wired](#how-hooks-are-wired)
      - [Hook Payload Structure (`HookEventPayload`)](#hook-payload-structure-hookeventpayload)
      - [Hook Audit Log](#hook-audit-log)
      - [Spawn Queue](#spawn-queue)
    - [Provider \& Model Configuration](#provider--model-configuration)
      - [Provider Selection](#provider-selection)
      - [Model Selection](#model-selection)
      - [Live Model Catalog](#live-model-catalog)
      - [Supported Providers](#supported-providers)
      - [Custom Base URL](#custom-base-url)
  - [Environment Variables](#environment-variables)
  - [Configuration Object (`Config`)](#configuration-object-config)
  - [Internal Architecture](#internal-architecture)
  - [Examples](#examples)

---

## Overview

`@cline/cli` is a fast, lightweight command-line interface for running **agentic loops** powered by large language models (LLMs). It is designed for minimal startup latency and real-time streaming output.

Key design principles:
- **Speed-first** — minimal dependencies, Bun runtime, streaming from first token
- **Composable** — pipe input, chain with shell scripts, spawn sub-agents
- **Persistent** — every session is recorded to a local SQLite database with full transcripts and message history
- **Extensible** — pluggable tool system, multi-provider support, agent teams

---

## Installation & Build

```bash
# From the monorepo packages directory
bun install
bun run build

# Run directly without building
bun run packages/cli/src/index.ts "your prompt"

# After build, the binary is available as:
agent "your prompt"
```

**Build scripts** (from `package.json`):

| Script | Command |
|--------|---------|
| `build` | `bun build ./src/index.ts --outdir ./dist --target node --format esm && bun tsc --emitDeclarationOnly` |
| `dev` | `bun run ./src/index.ts` |
| `clean` | `rm -rf dist` |
| `typecheck` | `bun tsc --noEmit` |

The compiled binary is placed at `./dist/index.js` and exposed via the `"bin": { "agent": "./dist/index.js" }` field in `package.json`.

---

## CLI Entry Point & Argument Parsing

**Source:** `src/index.ts` → `main()` function  
**Arg parser:** `src/utils/helpers.ts` → `parseArgs(args: string[])`

The CLI entry point (`main()`) performs the following steps on startup:

1. **Parse arguments** via `parseArgs(process.argv.slice(2))`
2. **Check for special subcommands** — `hook` and `sessions` are dispatched before any agent is created
3. **Show help or version** if `-h`/`--help` or `-v`/`--version` flags are present
4. **Resolve provider & model** from flags or environment variables
5. **Fetch live model catalog** from `models.dev` (non-blocking, falls back to bundled catalog)
6. **Read stdin** if the process is not a TTY (pipe mode)
7. **Create a CLI session** in the local SQLite database
8. **Bind exit handlers** (SIGTERM, SIGINT, process `exit`)
9. **Dispatch** to `runInteractive()` or `runAgent()` depending on flags

### Argument Parser (`parseArgs`)

`parseArgs` performs a single left-to-right scan of `process.argv`. It recognises:

- **Flags** (e.g. `-i`, `--no-tools`) — set boolean fields on `ParsedArgs`
- **Value flags** (e.g. `-m claude-opus-4`, `--cwd /tmp`) — consume the next token as the value
- **Positional arguments** — everything that does not start with `-` is joined with spaces and becomes the `prompt`

```typescript
interface ParsedArgs {
  prompt?: string               // positional args joined
  systemPrompt?: string         // -s / --system
  interactive: boolean          // -i / --interactive
  showHelp: boolean             // -h / --help
  showVersion: boolean          // -v / --version
  showUsage: boolean            // -u / --usage
  showTimings: boolean          // -t / --timings
  thinking: boolean             // --thinking
  outputMode: "text" | "json"   // --output / --json
  invalidOutputMode?: string    // invalid --output value (error path)
  enableSpawnAgent: boolean     // --spawn / --enable-spawn
  enableAgentTeams: boolean     // --teams
  enableTools: boolean          // --tools (default true) / --no-tools
  model?: string                // -m / --model
  provider?: string             // -p / --provider
  maxIterations?: number        // -n / --max-iterations
  cwd?: string                  // --cwd
  teamName?: string             // --team-name
  missionLogIntervalSteps?: number  // --mission-step-interval
  missionLogIntervalMs?: number     // --mission-time-interval-ms
}
```

---

## Commands & Subcommands

### 1. Single-Shot Mode

**Usage:**
```bash
agent "your prompt here"
agent --no-tools "What is 2+2?"
agent -s "You are a pirate" "Tell me about the sea"
agent -m claude-opus-4-20250514 "Explain string theory"
agent -u -t "Explain quantum computing"
```

**How it works:**

Single-shot mode is the default when a prompt is provided as a positional argument (and `-i` is not set). It calls `runAgent(prompt, config)`:

1. Records start time (`performance.now()`)
2. Creates runtime hooks (subprocess hook process)
3. Calls `buildRuntimeEnvironment()` to assemble tools and optional team runtime
4. Instantiates a new `Agent` with the resolved provider, model, system prompt, and tools
5. Registers a SIGINT handler that calls `agent.abort()` and shuts down the team runtime
6. Calls `agent.run("<user_input mode="mode">prompt</user_input>")` — this streams events via `onEvent`
7. Persists the full message history to `<sessionId>/<sessionId>.messages.json`
8. Optionally prints timing and token usage stats
9. Updates the session status in SQLite (`completed`, `failed`, or `cancelled`)

**Abort behaviour:**  
Pressing `Ctrl+C` during a run triggers SIGINT → `abortAll("sigint")` → `agent.abort()` + team shutdown. The session is marked `cancelled`.

**Output format:**  
All output is written directly to `process.stdout` (no buffering). Tool calls are shown inline:
```
[tool_name] <input summary>
  -> <output summary>
```

---

### 2. Interactive Mode (`-i`)

**Usage:**
```bash
agent -i
agent -i -s "You are an expert Python developer"
agent -i --teams --team-name my-team
```

**How it works:**

Interactive mode is activated by the `-i` / `--interactive` flag. It calls `runInteractive(config)`:

1. Prints a welcome banner with the model name
2. Creates a **single persistent `Agent` instance** for the entire session (conversation history is maintained across turns)
3. Creates a `readline` interface on `process.stdin` with a `> ` prompt
4. For the **first message**, calls `agent.run(...)` 
5. For **subsequent messages**, calls `agent.continue(...)` — this appends to the existing conversation
6. Each turn persists messages to disk after completion
7. Timing/usage stats are shown after each turn if `-t`/`-u` flags are set

**SIGINT behaviour in interactive mode:**
- If an agent run is **in progress**: aborts the current run, prints `[abort] requested`, then resumes the prompt
- If **no run is active**: closes the readline interface and exits cleanly

**Prompt display:**
```
agent (claude-sonnet-4-20250514)
Type your message. Press Ctrl+C to exit.

> 
```

---

### 3. Pipe / Stdin Mode

**Usage:**
```bash
echo "Summarize this" | agent
cat src/index.ts | agent "Review this code for bugs"
git diff | agent "Write a commit message for this diff"
```

**How it works:**

When `process.stdin.isTTY` is `false` (i.e. stdin is a pipe), the CLI reads all stdin bytes before starting the agent:

```typescript
const stdinContent = await readStdinUtf8()
```

The stdin content is **prepended** to the prompt:
```
<stdin>
<content from pipe>
</stdin>

<user prompt if provided>
```

If no positional prompt is given, the stdin content alone becomes the prompt. This allows full file contents to be passed to the agent for analysis, summarisation, or transformation.

---

### 4. Hook Subcommand

**Usage:**
```bash
agent hook          # called internally by the CLI itself
```

**This subcommand is not intended for direct user invocation.** It is used internally as a subprocess hook handler.

**How it works:**

When the CLI starts an agent run, it sets:
```
CLINE_ENABLE_SUBPROCESS_HOOKS=1
CLINE_HOOKS_LOG_PATH=~/.cline/data/sessions/<sessionId>/<sessionId>.hooks.jsonl
```

The `@cline/agents` SDK is configured with `createSubprocessHooks({ command: [bun, argv[1], "hook"] })`. For every lifecycle event (`tool_call`, `tool_result`, `agent_start`, `agent_resume`, `agent_abort`, `prompt_submit`, `agent_end`, `session_shutdown`), the SDK spawns a subprocess running `agent hook` and pipes a JSON payload to its stdin.

The `hook` handler in `main()`:
1. Reads the full JSON payload from stdin (`readStdinUtf8()`)
2. Parses and validates it with `parseCliHookPayload()`
3. Appends the event to the session's `.hooks.jsonl` audit log (`appendHookAudit`)
4. If the event is from a **sub-agent** (`parent_agent_id !== null`), upserts a sub-session record in SQLite (`upsertSubagentSessionFromHook`)
5. If the event is a `spawn_agent` tool call, queues the spawn request (`queueSpawnRequest`)
6. If the event signals sub-agent completion (`agent_end`, `session_shutdown`), updates the sub-session status (`applySubagentStatus`)
7. Writes a JSON response to stdout for the SDK to consume

**Hook event types handled:**

| `hookName` | Action |
|---|---|
| `tool_call` | Audit log + queue spawn if `spawn_agent` tool |
| `agent_start` / `agent_resume` | Upsert sub-session record |
| `prompt_submit` | Audit only |
| `agent_abort` | Audit + status transitions via shutdown handling |
| `agent_end` | Upsert sub-session + mark `completed` |
| `session_shutdown` | Mark sub-session `cancelled` or `failed` |

---

### 5. Sessions Subcommand

**Usage:**
```bash
agent sessions list
agent sessions list --limit 50
agent sessions delete <session-id>
```

**How it works:**

The `sessions` subcommand provides access to the local session database stored at `~/.cline/data/sessions/sessions.db` (SQLite).

#### `sessions list`

Lists recent CLI sessions in JSON format, ordered by `started_at DESC`. Default limit is 200.

Each record includes:
- `session_id` — unique session identifier (e.g. `cli_1708800000000_abc1234`)
- `source` — `"cli"` or `"cli-subagent"`
- `status` — `running` | `completed` | `failed` | `cancelled`
- `provider` / `model` — LLM provider and model used
- `cwd` / `workspace_root` — working directory
- `started_at` / `ended_at` — ISO timestamps
- `interactive` — whether it was an interactive session
- `prompt` — the initial prompt (truncated)
- `transcript_path` / `hook_path` / `messages_path` — paths to session artifacts

#### `sessions delete <id>`

Deletes a session and all its associated files:
- `<id>/<id>.log` — transcript
- `<id>/<id>.hooks.jsonl` — hook audit log
- `<id>/<id>.messages.json` — full message history
- `<id>/<id>.json` — session manifest

If the session is a **root session** (not a sub-agent), all child sub-sessions are also deleted.

---

## All Flags & Options

| Flag | Alias | Type | Default | Description |
|------|-------|------|---------|-------------|
| `--help` | `-h` | boolean | `false` | Show help text and exit |
| `--version` | `-v` | boolean | `false` | Show version and exit |
| `--interactive` | `-i` | boolean | `false` | Start interactive (multi-turn) mode |
| `--system <prompt>` | `-s` | string | *(default system prompt)* | Override the system prompt |
| `--model <id>` | `-m` | string | `claude-sonnet-4-20250514` | LLM model ID |
| `--provider <id>` | `-p` | string | `anthropic` | LLM provider ID |
| `--max-iterations <n>` | `-n` | number | `20` | Maximum agentic loop iterations |
| `--usage` | `-u` | boolean | `false` | Print token usage after each run |
| `--timings` | `-t` | boolean | `false` | Print elapsed time after each run |
| `--thinking` | — | boolean | `false` | Enable model thinking/reasoning when supported |
| `--output <text\|json>` | — | string | `text` | Output format (`text` or NDJSON `json`) |
| `--json` | — | boolean | `false` | Shorthand for `--output json` |
| `--tools` | — | boolean | `true` | Enable built-in tools (default on) |
| `--no-tools` | — | boolean | — | Disable all built-in tools |
| `--auto-approve-tools` | — | boolean | `true` | Auto-approve tool calls by default |
| `--require-tool-approval` | — | boolean | `false` | Require approval before each tool call by default |
| `--tool-enable <name>` | — | string | — | Explicitly enable a specific tool |
| `--tool-disable <name>` | — | string | — | Explicitly disable a specific tool |
| `--tool-autoapprove <name>` | — | string | — | Auto-approve a specific tool |
| `--tool-require-approval <name>` | — | string | — | Require approval for a specific tool |
| `--spawn` / `--enable-spawn` | — | boolean | `true` | Enable sub-agent spawning tool |
| `--teams` | — | boolean | `true` | Enable agent teams runtime |
| `--team-name <name>` | — | string | `agent-team-<id>` | Name for the agent team |
| `--cwd <path>` | — | string | `process.cwd()` | Working directory for tools |
| `--mission-step-interval <n>` | — | number | *(SDK default)* | Mission log interval in steps |
| `--mission-time-interval-ms <n>` | — | number | *(SDK default)* | Mission log interval in milliseconds |

---

## Features In Depth

### Streaming Output & Event Handling

**Source:** `handleEvent(event: AgentEvent, config: Config)` in `src/index.ts`

All agent output is streamed in real-time via the `onEvent` callback. The event handler writes directly to `process.stdout` with no buffering:

| Event Type | Output |
|---|---|
| `text` | Raw text written immediately to stdout |
| `tool_call_start` | `\n[tool_name] <input summary>` in dim/cyan |
| `tool_call_end` (success) | `\n  -> <output summary>` in dim, or `ok` in green |
| `tool_call_end` (error) | `error: <message>` in red |
| `done` | `── finished: <reason> (<n> iterations) ──` in dim |
| `error` | `error: <message>` in red |
| `iteration_start` | *(dev mode only)* `── iteration N ──` in yellow |

When `--output json` (or `--json`) is used, output switches to **NDJSON**:
- each line is a JSON object with `ts` and event payload
- event records include `run_start`, `agent_event`, `team_event`, `run_result`
- error records are emitted as JSON to stderr (`{ "type": "error", ... }`)
- interactive mode is rejected in JSON mode; use a prompt argument or piped stdin

**Tool input formatting** (`formatToolInput`):  
Each tool has a custom compact display format:

| Tool | Display |
|---|---|
| `run_commands` | Commands joined with `; ` (truncated to 60 chars each) |
| `read_files` | File paths joined with `, ` (truncated to 40 chars each) |
| `search_codebase` | Queries joined with `, ` |
| `fetch_web_content` | URLs joined with `, ` |
| `spawn_agent` | Task description (50 chars) |
| `team_member` | `spawn <agentId>: <rolePrompt>` or `shutdown <agentId>` |
| `team_task` | `create <title>`, `claim <taskId>`, `complete <taskId>: <summary>`, `block <taskId>: <reason>` |
| `team_run_task` | `runMode agentId: task` (70 chars) |
| `team_message` | `send <toAgentId>: <subject>`, `broadcast <subject>`, `read unreadOnly=<bool> limit=<n\|default>` |

**ANSI color scheme** (no external dependencies):

| Color | Usage |
|---|---|
| `dim` | Tool calls, metadata, separators |
| `cyan` | Tool input values, teammate IDs |
| `green` | Successful tool output, prompt symbol |
| `red` | Errors |
| `yellow` | Iteration markers (dev mode) |

---

### Tools System

**Source:** `src/utils/helpers.ts` → `createBuiltinToolsList()`, `buildRuntimeEnvironment()`

Tools are enabled by default (`--tools` is `true`). Pass `--no-tools` to disable all tools.

**Built-in tools** (from `@cline/agents` → `createBuiltinTools`):

| Tool | Flag | Description |
|---|---|---|
| `read_files` | `enableReadFiles: true` | Read one or more files from the filesystem |
| `search_codebase` | `enableSearch: true` | Regex search across the codebase |
| `run_commands` | `enableBash: true` | Execute shell commands |
| `fetch_web_content` | `enableWebFetch: true` | Fetch and analyse web pages |

All built-in tools are scoped to the `cwd` (working directory), which defaults to `process.cwd()` and can be overridden with `--cwd`.

#### Tool Approval Policies

Tool approvals are policy-based:
- Global default is controlled by `--auto-approve-tools` (default) or `--require-tool-approval`.
- Per-tool overrides are controlled by `--tool-autoapprove <name>` and `--tool-require-approval <name>`.

Example: require approval for editor only:

```bash
agent --tool-require-approval editor "Update docs and changelog"
```

`editor` is the built-in filesystem editing tool name.

#### How User Approval Works in CLI

When a tool call requires approval, the terminal prompt is:

```text
Approve tool "<tool_name>" with input <preview>? [y/N]
```

- `y` / `yes`: approve and execute the tool call.
- Any other input (including empty Enter): reject the tool call.
- If not running in a TTY (for example, non-interactive stdin/stdout), approval-required tool calls are denied.

When `CLINE_TOOL_APPROVAL_MODE=desktop`, approvals are handled through desktop IPC files instead of terminal prompts.

**Tool assembly flow:**

```
buildRuntimeEnvironment()
  ├── if enableTools → createBuiltinToolsList(cwd)
  ├── if enableSpawnAgent → createCliSpawnTool(config, hooks)
  └── if enableAgentTeams → bootstrapAgentTeams() → team tools
```

The final `tools[]` array is passed directly to the `Agent` constructor.

---

### Sub-Agent Spawning (`--spawn`)

**Usage:**
```bash
agent --spawn "Research and summarise the top 5 AI papers from 2024"
```

**Source:** `createCliSpawnTool()` in `src/index.ts`, wraps `createSdkSpawnAgentTool` from `@cline/agents`

When `--spawn` (or `--enable-spawn`) is passed, the agent gains access to a `spawn_agent` tool that allows it to delegate subtasks to child agents.

**Configuration:**
```typescript
createSdkSpawnAgentTool({
  providerId, modelId, apiKey, baseUrl, knownModels,
  defaultMaxIterations: 5,           // sub-agents get 5 iterations by default
  createSubAgentTools: () => createBuiltinToolsList(config.cwd),
  hooks,                             // same hook chain as parent
  onSubAgentStart: ({ subAgentId, conversationId, parentAgentId, input }) => { ... },
  onSubAgentEnd:   ({ subAgentId, conversationId, parentAgentId, input, result, error }) => { ... },
})
```

**Sub-agent lifecycle tracking:**

When a sub-agent starts (`onSubAgentStart`), the CLI:
1. Creates a new session record in SQLite with `is_subagent = 1`
2. Sets `parent_session_id` and `parent_agent_id` to link it to the root session
3. Writes a `<subSessionId>.messages.json` and `<subSessionId>.json` manifest
4. Appends `[start] <task>` to the sub-session transcript

When a sub-agent ends (`onSubAgentEnd`):
1. Updates the sub-session status to `completed`, `failed`, or `cancelled`
2. Appends the finish reason to the transcript
3. Persists the sub-agent's full message history

Sub-agents inherit the parent's provider, model, and working directory. They receive the same built-in tools and also receive `spawn_agent` when spawn is enabled, allowing recursive delegation.

---

### Agent Teams (`--teams`)

**Usage:**
```bash
agent --teams "Coordinate a team to write a full test suite for this codebase"
agent --teams --team-name research-team "Research quantum computing"
agent --teams --mission-step-interval 5 --mission-time-interval-ms 30000 "..."
```

**Source:** `buildRuntimeEnvironment()` in `src/utils/helpers.ts`, `handleTeamEvent()` in `src/index.ts`

Agent teams enable the lead agent to spawn, coordinate, and communicate with multiple **teammate agents** that run concurrently.

**How it works:**

1. `AgentTeamsRuntime` is instantiated with a `teamName` and `leadAgentId: "lead"`
2. `bootstrapAgentTeams()` wires up the runtime and returns a set of **team tools** injected into the lead agent
3. Team state is persisted to disk via `FileTeamPersistenceStore` — if the CLI is restarted with the same `--team-name`, the team state is **restored**
4. All team events are handled by `handleTeamEvent()` and also persisted via `teamPersistence.appendTaskHistory(event)`

**Team tools available to the lead agent:**

| Tool | Description |
|---|---|
| `team_member` | Manage teammate lifecycle (`action: spawn` or `shutdown`) |
| `team_status` | Get a snapshot of all teammates, tasks, mailbox, and mission log |
| `team_task` | Manage shared tasks (`action: create`, `claim`, `complete`, `block`) |
| `team_run_task` | Delegate a task to a teammate (sync or async) |
| `team_list_runs` | List async teammate runs |
| `team_await_run` | Wait for one or all async runs to complete |
| `team_message` | Team mailbox operations (`action: send`, `broadcast`, `read`) |
| `team_log_update` | Append a mission log entry |
| `team_cleanup` | Clean up the team runtime |

**Team event display:**

| Event | Console output |
|---|---|
| `teammate_spawned` | `[team] teammate spawned: <agentId>` |
| `teammate_shutdown` | `[team] teammate shutdown: <agentId>` |
| `team_task_updated` | `[team task] <taskId> -> <status>` |
| `team_message` | `[mailbox] <from> -> <to>: <subject>` |
| `team_mission_log` | `[mission] <agentId>: <summary (90 chars)>` |
| `task_start` | Creates a sub-session record in SQLite |
| `task_end` | Updates sub-session status + persists messages |

**Team persistence:**

Team state (teammates, tasks, message history, mission log) is persisted to a file store keyed by `teamName`. On restart with the same `--team-name`, the runtime is restored and the CLI prints:
```
[team] restored persisted team state for "my-team"
```

**Mission log intervals:**

The mission log is a periodic summary written by the lead agent. Intervals can be tuned:
- `--mission-step-interval <n>` — log every N agent steps
- `--mission-time-interval-ms <n>` — log every N milliseconds

---

### Session Management

**Source:** `src/utils/session.ts`, `src/utils/helpers.ts`

Every CLI invocation creates a **session** tracked in a local SQLite database.

**Database location:** `~/.cline/data/sessions/sessions.db`  
**Sessions directory:** `~/.cline/data/sessions/`

#### Session Lifecycle

```
main()
  └── createCliSession()          → INSERT into sessions table
        └── <sessionId>/
            ├── <sessionId>.json      → manifest file (JSON)
            ├── <sessionId>.log       → transcript (append-only)
            ├── <sessionId>.hooks.jsonl → hook audit log (append-only)
            └── <sessionId>.messages.json → full API message history
  └── bindCliSessionExitHandlers()
        ├── process.on("exit")    → mark completed/failed
        ├── process.on("SIGTERM") → mark cancelled, exit 143
        └── process.on("SIGINT")  → mark cancelled
  └── runAgent() / runInteractive()
  └── updateCliSessionStatus()    → UPDATE sessions (optimistic locking)
```

#### Session ID

Session IDs are generated as:
```
cli_<timestamp>_<7-char random base36>
```
e.g. `cli_1708800000000_abc1234`

The session ID is also set as `process.env.CLINE_SESSION_ID` so that subprocess hooks can reference it.

#### Session Status

| Status | Meaning |
|---|---|
| `running` | Agent is currently executing |
| `completed` | Agent finished successfully (exit code 0) |
| `failed` | Agent encountered an error (exit code 1) |
| `cancelled` | Aborted by SIGINT or SIGTERM |

Status updates use **optimistic locking** (`status_lock` column) with up to 4 retry attempts to handle concurrent updates from hook subprocesses.

#### Session Manifest (`<sessionId>/<sessionId>.json`)

```json
{
  "version": 1,
  "session_id": "cli_1708800000000_abc1234",
  "source": "cli",
  "pid": 12345,
  "started_at": "2024-02-24T12:00:00.000Z",
  "status": "completed",
  "interactive": false,
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514",
  "cwd": "/Users/user/project",
  "workspace_root": "/Users/user/project",
  "team_name": null,
  "enable_tools": true,
  "enable_spawn": false,
  "enable_teams": false,
  "prompt": "What is 2+2?",
  "messages_path": "~/.cline/data/sessions/cli_1708800000000_abc1234/cli_1708800000000_abc1234.messages.json"
}
```

#### Sub-Session IDs

Sub-agent sessions use a deterministic ID:
```
<rootSessionId>__<agentId>   (max 180 chars)
```

Team task sub-sessions use a unique ID with a nonce:
```
<rootSessionId>__teamtask__<agentId>__<timestamp>_<nonce>
```

#### Message Persistence

After every agent run (and on error/abort), the full API message history is written to `<sessionId>/<sessionId>.messages.json`:

```json
{
  "version": 1,
  "updated_at": "2024-02-24T12:00:05.000Z",
  "messages": [ ... ]
}
```

This file is updated **best-effort** — even if the agent crashes, the last known messages are persisted in the `finally` block.

---

### Hook System

**Source:** `src/utils/helpers.ts` → `appendHookAudit`, `createRuntimeHooks`, `parseCliHookPayload`  
**Source:** `src/utils/session.ts` → `upsertSubagentSessionFromHook`, `applySubagentStatus`, `queueSpawnRequest`

The hook system provides a **side-channel audit trail** for every agent lifecycle event. It works by spawning a subprocess (`agent hook`) for each event.

#### How Hooks Are Wired

```typescript
// In createRuntimeHooks():
createSubprocessHooks({
  command: [process.execPath, process.argv[1], "hook"],
  env: process.env,
  cwd: process.cwd(),
  onDispatchError: (error) => { /* log in dev mode */ }
})
```

The hook subprocess receives a JSON payload on stdin and must respond with JSON on stdout.

#### Hook Payload Structure (`HookEventPayload`)

```typescript
{
  hookName: "tool_call" | "tool_result" | "agent_start" | "agent_resume" | "agent_abort" | "prompt_submit" | "agent_end" | "session_shutdown",
  taskId: string,
  clineVersion: string,
  timestamp: string,
  workspaceRoots: string[],
  userId: string,
  agent_id: string,
  parent_agent_id: string | null,
  tool_call?: {
    id: string,
    name: string,
    input: unknown
  },
  reason?: string   // for session_shutdown
}
```

#### Hook Audit Log

Every hook event is appended to `<sessionId>/<sessionId>.hooks.jsonl` as a newline-delimited JSON record:
```json
{"ts":"2024-02-24T12:00:01.000Z","hookName":"tool_call","taskId":"conv_abc","agent_id":"main","parent_agent_id":null,"tool_call":{"id":"call_1","name":"read_files","input":{"file_paths":["src/index.ts"]}}}
```

If `CLINE_HOOKS_LOG_PATH` is not set and `CLINE_SESSION_ID` is available, hooks are written to `~/.cline/data/sessions/<sessionId>/<sessionId>.hooks.jsonl`.

#### Spawn Queue

When the lead agent calls `spawn_agent`, the hook handler inserts a record into the `subagent_spawn_queue` table. When the sub-agent session is later created, it claims the queued task to populate its `prompt` field.

---

### Provider & Model Configuration

**Source:** `src/index.ts` → `main()`, `getLiveModelsCatalog` from `@cline/llms`

#### Provider Selection

The provider is resolved in this order:
1. `-p` / `--provider` flag
2. `CLINE_PROVIDER` environment variable
3. Default: `anthropic`

#### Model Selection

The model is resolved in this order:
1. `-m` / `--model` flag
2. `CLINE_MODEL` environment variable
3. Default: `claude-sonnet-4-20250514`

#### Live Model Catalog

On startup, the CLI attempts to fetch the latest model metadata from `models.dev`:
```typescript
const knownModels = await getLiveModelsCatalog()
```

This is a **non-blocking** fetch — if it fails or times out, the bundled model catalog is used as a fallback. The catalog source is shown in the model info line:
```
[model] provider=anthropic model=claude-sonnet-4-20250514 catalog=live
[model] provider=anthropic model=claude-sonnet-4-20250514 catalog=bundled
```

#### Supported Providers

| Provider | API Key Env Var | Notes |
|---|---|---|
| `anthropic` | `ANTHROPIC_API_KEY` | Default provider |
| `openai` | `OPENAI_API_KEY` | Use with `-p openai` |
| *(others)* | *(provider-specific)* | Any provider supported by `@cline/llms` |

#### Custom Base URL

For self-hosted or proxy endpoints, set `CLINE_BASE_URL` or use a provider that supports custom base URLs.

---

## Environment Variables

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | API key for Anthropic (required when using `anthropic` provider) |
| `OPENAI_API_KEY` | API key for OpenAI (required when using `openai` provider) |
| `CLINE_PROVIDER` | Default provider ID (overridden by `-p`) |
| `CLINE_MODEL` | Default model ID (overridden by `-m`) |
| `CLINE_BASE_URL` | Custom base URL for the LLM API |
| `CLINE_SESSION_ID` | Override the session ID (set automatically; used by hook subprocesses) |
| `CLINE_HOOKS_LOG_PATH` | Path for the hook audit log (set automatically per session) |
| `CLINE_ENABLE_SUBPROCESS_HOOKS` | Set to `"1"` to enable hook subprocess dispatch (set automatically) |
| `NODE_ENV` | Set to `"development"` to enable verbose dev output (iteration markers) |

---

## Configuration Object (`Config`)

The `Config` interface is the internal runtime configuration assembled from parsed args and environment variables:

```typescript
interface Config {
  providerId: string          // resolved provider
  modelId: string             // resolved model
  apiKey: string              // resolved API key
  baseUrl?: string            // optional custom base URL
  knownModels?: Record<string, ModelInfo>  // live model catalog
  systemPrompt: string        // system prompt (default or custom)
  maxIterations?: number      // max agentic loop iterations
  showUsage: boolean          // -u flag
  showTimings: boolean        // -t flag
  outputMode: "text" | "json" // --output / --json
  enableSpawnAgent: boolean   // --spawn flag
  enableAgentTeams: boolean   // --teams flag
  enableTools: boolean        // --tools / --no-tools
  cwd: string                 // working directory
  teamName?: string           // --team-name
  missionLogIntervalSteps: number   // --mission-step-interval
  missionLogIntervalMs: number      // --mission-time-interval-ms
}
```

---

## Internal Architecture

```
src/
├── index.ts                  # Entry point, main(), all command dispatch
│   ├── main()                # Startup, arg parsing, session creation
│   ├── runAgent()            # Single-shot agent execution
│   ├── runInteractive()      # Interactive REPL loop
│   ├── handleEvent()         # AgentEvent → stdout renderer
│   ├── handleTeamEvent()     # TeamEvent → stdout renderer + session tracking
│   ├── createCliSession()    # SQLite session creation + file setup
│   ├── updateCliSessionStatus() # Optimistic-lock status update
│   ├── bindCliSessionExitHandlers() # SIGTERM/SIGINT/exit handlers
│   ├── createRuntimeHooks()  # Subprocess hook wiring
│   ├── createCliSpawnTool()  # Sub-agent spawn tool factory
│   └── persistApiMessages()  # Message history persistence
│
└── utils/
    ├── helpers.ts            # Pure utilities
    │   ├── parseArgs()       # CLI argument parser
    │   ├── buildRuntimeEnvironment() # Tool + team runtime assembly
    │   ├── createBuiltinToolsList()  # Built-in tool factory
    │   ├── formatToolInput() # Tool display formatting
    │   ├── formatToolOutput()# Output display formatting
    │   ├── appendHookAudit() # Hook JSONL appender
    │   ├── isCliHookPayload()# Hook payload validator
    │   ├── readStdinUtf8()   # Async stdin reader
    │   ├── resolveWorkspaceRoot() # Git root resolver
    │   └── shutdownTeamRuntime()  # Team graceful shutdown
    │
    ├── session.ts            # Session database management
    │   ├── getSessionDb()    # SQLite connection + schema migration
    │   ├── ensureSessionsDir() # ~/.cline/data/sessions/ creation
    │   ├── listCliSessions() # SELECT sessions ORDER BY started_at DESC
    │   ├── deleteCliSession()# DELETE session + files
    │   ├── upsertSubagentSession() # Sub-agent session upsert
    │   ├── handleSubAgentStart/End() # Sub-agent lifecycle hooks
    │   ├── onTeamTaskStart/End()     # Team task session tracking
    │   └── applySubagentStatus()    # Status update for sub-sessions
    │
    └── types.ts              # TypeScript interfaces
        ├── Config            # Runtime configuration
        ├── ParsedArgs        # Parsed CLI arguments
        ├── ActiveCliSession  # In-memory session state
        └── SessionDbRow      # SQLite row type
```

**Data flow:**

```
stdin / argv
    │
    ▼
parseArgs()
    │
    ▼
main() ──────────────────────────────────────────────────────┐
    │                                                         │
    ├─ "hook" subcommand ──► appendHookAudit()               │
    │                        upsertSubagentSessionFromHook()  │
    │                        applySubagentStatus()            │
    │                                                         │
    ├─ "sessions" subcommand ──► listCliSessions()            │
    │                            deleteCliSession()           │
    │                                                         │
    └─ agent run                                              │
         │                                                    │
         ▼                                                    │
    createCliSession() ──► SQLite + files                     │
         │                                                    │
         ▼                                                    │
    buildRuntimeEnvironment()                                 │
         ├── createBuiltinToolsList()                         │
         ├── createCliSpawnTool()                             │
         └── bootstrapAgentTeams()                            │
         │                                                    │
         ▼                                                    │
    Agent.run() / Agent.continue()                            │
         │                                                    │
         ├── onEvent ──► handleEvent() ──► stdout             │
         ├── hooks ───► agent hook subprocess ──────────────►─┘
         └── result ──► persistApiMessages()
                        updateCliSessionStatus()
```

---

## Examples

```bash
# Quick question (no tools needed)
agent --no-tools "What is the capital of France?"

# Code review via pipe
cat src/index.ts | agent "Review this code for bugs and suggest improvements"

# Summarise a git diff
git diff HEAD~1 | agent "Write a concise commit message for this diff"

# Custom persona
agent -s "You are Shakespeare" "Write a sonnet about artificial intelligence"

# Use a specific model
agent -m claude-opus-4-20250514 "Explain the theory of relativity"

# Use OpenAI
agent -p openai -m gpt-4o "What are the best practices for TypeScript?"

# Show timing and token usage
agent -u -t "Explain quantum entanglement"

# Parseable JSON output (NDJSON)
agent --output json "Summarize key architecture decisions in this repo"

# JSON mode with stdin
cat package.json | agent --json "Extract dependency names only"

# Interactive coding session
agent -i -s "You are an expert TypeScript developer. Help me refactor my code."

# Interactive session with teams enabled
agent -i --teams --team-name dev-team

# Single-shot with sub-agent spawning
agent --spawn "Research the top 5 JavaScript frameworks and write a comparison report"

# Agent teams for complex multi-step work
agent --teams "Coordinate a team to: 1) audit the codebase, 2) write tests, 3) generate docs"

# Custom working directory
agent --cwd /path/to/project "Explain the architecture of this project"

# Restore a previous team session
agent --teams --team-name my-team "Continue where we left off"

# List recent sessions
agent sessions list

# Delete a session
agent sessions delete cli_1708800000000_abc1234

# Pipe a file for analysis
cat package.json | agent "What dependencies does this project use and what do they do?"

# Use environment variable for model
CLINE_MODEL=claude-opus-4-20250514 agent "Write a haiku about Bun.js"
```

---

*Generated from source: `src/index.ts`, `src/utils/helpers.ts`, `src/utils/session.ts`, `src/utils/types.ts`*
