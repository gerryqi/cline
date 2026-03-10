# Cline Cli Lite

Cline CLI built with Cline SDK. 

Streams output in real time and includes built-in tools, sub-agent spawning, and team runtime support by default.


## Requirements

- [Bun](https://bun.com/docs/installation) (for development, build, and running `clite`)

## Installation

> NOTE: The package is not published yet, so the CLI is not available on npm. To use the CLI, you can clone the repository and link the package locally with `bun link` from the `@cline/cli` workspace. Global installation from npm will be available after the initial release.

```bash
npm i -g @cline/cli
# or
bun i -g @cline/cli
```

## Development

Quick Start:

```bash
# From Root of the repository
bun install
bun run build

bun run dev:cli # Run Dev script for the CLI package 
# or
bun run -F @cline/cli dev "your prompt" # Run the CLI from the package workspace
# or
bun link # Link the package globally for easy access from anywhere
# Run from the linked binary
clite auth

# Run built CLI with Bun
bun cli/dist/index.js "your prompt"
```

Dev runtime note:

- Distinct host ID resolution is handled by `@cline/core/server` `createSessionHost(...)`.
- When no explicit `distinctId` is provided, core persists a fallback ID at `<session-data-dir>/machine-id` (for example `~/.cline/data/sessions/machine-id`).

## Publishing

From the @cline/cli package workspace:

```bash
# Package the latest model list from models.dev
bun run build:models

# Dry run for checking package size and build output
bun publish --dry-run
# Example Output: Total files: 3 / Unpacked size: 2.28MB

# Publish to npm (version bump required)
bun run release
```

## Testing

```bash

# Run CLI unit tests
bun -F @cline/cli test:unit

# Run CLI e2e tests
bun -F @cline/cli test:e2e
```

## Usage

```bash
# Start Cline CLI without a prompt to enter interactive mode
clite

# Single prompt / One-shot - includes tools + spawn + teams
clite "Audit this package and propose fixes"
# NOTE: Single-prompt runs are non-interactive and exit when the turn finishes

# Interactive mode
clite -i
# With custom system prompt
clite -i -s "You are a pirate" "Tell me about the sea"
clite -i "Let's work on this together. First, analyze the current state and suggest next steps."

# Disable defaults tools, spawn(subagent), teams explicitly
clite --no-tools --no-spawn --no-teams "Answer from general knowledge only"
# Require approval before each tool call
clite --require-tool-approval "Inspect and modify this repository"
# Require approval only for command execution
clite --tool-require-approval run_commands "Fix failing tests"
# Require approval for editor only
clite --tool-require-approval editor "Refactor src/index.ts for readability"

# Pipe input
cat file.txt | clite "Summarize this"

# Team workflow with persistent name
clite --team-name my-team "Plan, implement, and verify release checklist"
clite --team-name my-team "Continue yesterday's team workflow"

# Show usage stats (tokens + estimated cost when available)
clite -u -t "Explain quantum computing"

# Stream structured NDJSON output
clite --output json "Summarize this repository"
# equivalent
clite --json "Summarize this repository"

# Use a specific provider, model, and access token for a single prompt/task
clite -p openrouter -m google/gemini-3-pro -k sk-your-google-gemini-api-key "Set up a storybook for the frontend react ui components"
# Use a different model with the last used provider
clite -m anthropic/claude-opus-4-6 "Explain string theory"
# Refresh model catalog from provider endpoints for this run 
# to use a new model not available in the built-in model catalog yet 
clite --refresh-models -p cline -m "openai/gpt-10"

# Quick setup with API key/model
clite auth --provider anthropic --apikey sk-... --modelid claude-sonnet-4-6
clite auth --provider openai-native --apikey sk-... --modelid gpt-5 --baseurl https://api.example.com/v1

# Authenticate OAuth providers explicitly
clite auth <cline|openai-codex|oca>

# Open interactive config view directly
clite config
# Running `clite` with no prompt also enters interactive mode.
# Interactive mode is rendered with the Ink TUI.
# The initial screen uses a WelcomeView-style layout before the first prompt.
# Inline composer supports completion menus:
# - `@` opens workspace file mention search (arrow keys to move, Enter/Tab to insert)
# - `/` opens workflow slash command search (arrow keys to move, Enter/Tab to insert)
# - `/config` (or `/settings`) opens the interactive config browser
#   with tabs for workflows, rules, skills, hooks, and agents
# Footer rows mirror the legacy CLI layout:
# 1) command/file hint + Plan/Act badges (Tab)
# 2) provider/model + context bar + token/cost
# 3) repo/branch + git diff stats
# 4) auto-approve state (Shift+Tab toggles)
# For one-shot auto-exit behavior, pass a prompt argument.
# Exit interactive mode with Ctrl+D (or Ctrl+C when idle).

# INTERNAL: RPC gateway commands for host integration and runtime management
# Start the RPC gateway server
clite rpc start
clite rpc start --address 127.0.0.1:4317
# Check whether an RPC gateway is running
clite rpc status
clite rpc status --address 127.0.0.1:4317
# Request RPC gateway shutdown
clite rpc stop
clite rpc stop --address 127.0.0.1:4317
# Ensure a compatible runtime server is available (JSON output for host apps)
clite rpc ensure --address 127.0.0.1:4317 --json
# For new client to call to register with the RPC gateway
clite rpc register --address 127.0.0.1:4317 --client-type desktop --client-id code-desktop
clite rpc register --meta app=code --meta host=tauri

# Schedule agents on cron-like intervals (runs through RPC server runtime)
clite schedule create "Daily code review" \
  --cron "0 9 * * MON-FRI" \
  --prompt "Review PRs opened yesterday and summarize issues." \
  --workspace /path/to/repo \
  --provider cline \
  --model openai/gpt-5.3-codex \
  --timeout 3600 \
  --max-iterations 50 \
  --tags automation,review
clite schedule list
clite schedule get <schedule-id>
clite schedule trigger <schedule-id>
clite schedule history <schedule-id> --limit 20
clite schedule stats <schedule-id>
clite schedule active
clite schedule upcoming --limit 10
clite schedule export <schedule-id> > daily-review.yaml
clite schedule import ./daily-review.yaml
```

## OAuth Authentication

`clite` supports OAuth login for:

- `cline`
- `openai-codex`
- `oca`

When you run with one of these providers and no API key is available, `clite` will automatically start the OAuth login flow and persist credentials to provider settings.

During OAuth login, `clite` tries to open the authorization URL in your default browser automatically and still prints the URL for manual fallback.

`clite auth` (without a provider) opens the interactive auth TUI with the same auth options as the old CLI flow:

- Sign in with Cline
- Sign in with ChatGPT Subscription (`openai-codex`)
- Sign in with OCA
- Use your own API key (provider + model + optional base URL)

RPC runtime note:

- RPC chat payload parsers normalize invalid optional `maxIterations` values (including JSON `null`) to `undefined` so sessions do not terminate immediately with `finishReason="max_iterations"` at iteration 0.

## Options

| Flag | Description |
|------|-------------|
| `-s, --system <prompt>` | System prompt for the agent |
| `-m, --model <id>` | Model ID (default: provider's first model from bundled catalog; fallback `claude-sonnet-4-6`) |
| `-p, --provider <id>` | Provider ID (default: anthropic) |
| `-k, --key <api-key>` | API key override for this run |
| `-n, --max-iterations <n>` | Max agentic loop iterations (optional; unset means unbounded) |
| `-i, --interactive` | Interactive mode |
| `-u, --usage` | Show token usage and estimated cost (when available) |
| `-t, --timings` | Show timing info |
| `--thinking` | Enable model thinking/reasoning when supported |
| `--refresh-models` | Refresh model catalog from provider endpoints for this run |
| `--mode <act\|plan>` | Agent mode for tool presets (default: `act`) |
| `--output <text\|json>` | Output format (default: `text`) |
| `--json` | Shorthand for `--output json` (NDJSON stream) |
| `--sandbox` | Run with isolated local state; avoids writing to `~/.cline` |
| `--sandbox-dir <path>` | Sandbox state directory (default: `$CLINE_SANDBOX_DATA_DIR` or `/tmp/cline-sandbox`) |
| `--tools` | Enable default tools (enabled by default) |
| `--no-tools` | Disable default tools |
| `--spawn` | Enable `spawn_agent` (enabled by default) |
| `--no-spawn` | Disable `spawn_agent` |
| `--teams` | Enable team tools/runtime (enabled by default) |
| `--no-teams` | Disable team tools/runtime |
| `--auto-approve-tools` | Auto-approve tool calls by default (default behavior) |
| `--require-tool-approval` | Require approval before each tool call by default |
| `--tool-enable <name>` | Explicitly enable a specific tool |
| `--tool-disable <name>` | Explicitly disable a specific tool |
| `--tool-autoapprove <name>` | Auto-approve a specific tool |
| `--tool-require-approval <name>` | Require approval for a specific tool |
| `--team-name <name>` | Team name used for team runtime state (default: generated as `agent-team-<id>`) |
| `--mission-step-interval <n>` | Mission log update interval in meaningful steps (default: `3`) |
| `--mission-time-interval-ms <ms>` | Mission log update interval in milliseconds (default: `120000`) |
| `--cwd <path>` | Working directory for built-in tools (default: current directory) |
| `--session <id>` | Resume interactive chat from a saved session id |
| `-h, --help` | Show help (exits immediately) |
| `-v, --version` | Show version (exits immediately) |

`--output json` is non-interactive and requires either a prompt argument or piped stdin.

Subcommands:

- `clite auth` - Run interactive auth setup TUI
- `clite auth <provider>` - Run OAuth login for `cline`, `openai-codex`, or `oca`
- `clite config` - Open interactive config view (workflows/rules/skills/hooks/agents)
- `clite rpc start` - Start the RPC gateway
- `clite rpc status` - Check whether the RPC gateway is healthy
- `clite rpc stop` - Request graceful shutdown of the RPC gateway
- `clite rpc ensure` - Ensure a compatible runtime-capable RPC server is available and return the effective address
- `clite rpc register` - Register a client id/type (+ optional metadata) with the RPC gateway
- `clite schedule create` - Create a scheduled runtime job
- `clite schedule list|get|update|pause|resume|delete|trigger|history|stats|active|upcoming|import|export` - Manage schedule definitions and execution history
- `clite list ...` - List workflows/rules/skills/agents/history/hooks/mcp

Auth quick-setup flags:

- `-p, --provider <id>`
- `-k, --apikey <key>`
- `-m, --modelid <id>`
- `-b, --baseurl <url>` (OpenAI/OpenAI-compatible quick setup)

MCP list examples:

```bash
clite list mcp
clite list mcp --json
```

## Tool Approval

Tool calls are auto-approved by default. Use approval flags to enforce review per tool call.

```bash
# Require approval for all tools
clite --require-tool-approval "Inspect and modify this repository"

# Require approval for editor only
clite --tool-require-approval editor "Update the changelog and README"

# Require approval for all tools, but allow reads without prompts
clite --require-tool-approval --tool-autoapprove read_files "Audit the current workspace"
```

When approval is required, the CLI prompts in TTY mode:

```text
Approve tool "<tool_name>" with input <preview>? [y/N]
```

- Enter `y` or `yes` to approve.
- Enter anything else (or press Enter) to reject.
- If stdin/stdout is not a TTY, required-approval calls are denied in terminal mode.
- RPC-backed prompt runs also honor required approvals: approval requests are relayed through RPC, prompted in the CLI TTY, and responded back to the runtime before tool execution continues.

Desktop-integrated approval mode is also supported via env wiring:

- `CLINE_TOOL_APPROVAL_MODE=desktop`
- `CLINE_TOOL_APPROVAL_DIR=<path>`

In desktop mode, CLI writes a request JSON file and waits for a matching decision JSON file.

## RPC Server

`clite rpc start` starts the `@cline/rpc` gRPC gateway.

- Default address: `127.0.0.1:4317`
- Override with `--address <host:port>` or `CLINE_RPC_ADDRESS`
- Startup behavior: checks health first; if already running at that address, it prints the running server id and exits without starting a duplicate
- Status check: `clite rpc status` prints running/not-running and returns exit code `0` when healthy (`1` when not running)
- Shutdown: `clite rpc stop` requests graceful shutdown for the target address; `clite rpc start` can also be stopped with Ctrl+C / `SIGTERM`
- Ensure: `clite rpc ensure` reuses a compatible server when possible; if the listener is stale/incompatible it can launch a fresh server on a new available port and report that effective address
- Compatibility check: `rpc ensure` requires runtime chat methods including `StartRuntimeSession`, `SendRuntimeSession`, `AbortRuntimeSession`, and `StopRuntimeSession`.
- Client registration: `clite rpc register --client-type <type> [--client-id <id>] [--meta key=value]...` registers host identity for RPC clients
- Runtime APIs: `clite rpc start` wires server-side runtime handlers for `StartRuntimeSession`, `SendRuntimeSession`, and `AbortRuntimeSession` (used by `@cline/code` and CLI runtime actions)
- Runtime event bridge: runtime handlers publish live `runtime.chat.*` events via RPC `PublishEvent`, so subscribed clients can consume real-time text/tool updates through `StreamEvents`
- Team event bridge: runtime handlers also publish typed team progress/lifecycle events (`runtime.team.progress.v1`, `runtime.team.lifecycle.v1`) with status-board projections
- Tool approval bridge: runtime handlers publish `approval.requested` and wait for RPC responses; CLI prompt runs consume these requests and return approval decisions through RPC.
- CLI streaming: RPC-backed prompt runs subscribe to `runtime.chat.*` during each turn, so text/tool output is rendered incrementally in the terminal.
- Prompt startup behavior: regular `clite "<prompt>"` runs call `rpc ensure --json` first to get a compatible address, then try to connect to the RPC server. If no server is running, one is spawned in the background and the CLI waits briefly for it to bind. If the background spawn fails, the CLI falls back to an in-process local runtime.

## Environment Variables

- `ANTHROPIC_API_KEY` - API key for Anthropic
- `CLINE_API_KEY` - API key for Cline (when using `-p cline`)
- `CLINE_DATA_DIR` - Base data directory for sessions/settings/teams/hooks
- `CLINE_SANDBOX` - Set to `1` to force sandbox mode
- `CLINE_SANDBOX_DATA_DIR` - Override sandbox state directory
- `CLINE_TEAM_DATA_DIR` - Override team persistence directory
- `CLINE_RPC_ADDRESS` - Address used by `clite rpc start` (default `127.0.0.1:4317`)
- `CLINE_TOOL_APPROVAL_MODE` - Approval mode (`desktop` uses file IPC; unset uses terminal prompt)
- `CLINE_TOOL_APPROVAL_DIR` - Directory for desktop approval request/decision files
- `CLINE_LOG_ENABLED` - Set to `0`/`false` to disable runtime file logging
- `CLINE_LOG_LEVEL` - Runtime log level (`trace|debug|info|warn|error|fatal|silent`, default `info`)
- `CLINE_LOG_PATH` - Runtime log file path (default `<CLINE_DATA_DIR>/logs/clite.log`)
- `CLINE_LOG_NAME` - Logger name embedded in runtime log records
- `OPENAI_API_KEY` - API key for OpenAI (when using `-p openai`)
- `OPENROUTER_API_KEY` - API key for OpenRouter (when using `-p openrouter`)
- `AI_GATEWAY_API_KEY` - API key for Vercel AI Gateway (when using `-p vercel-ai-gateway`)

`--key` takes precedence over environment variables.

For OAuth providers (`cline`, `openai-codex`, `oca`), you can either use `clite auth <provider>` or let `clite` prompt for OAuth automatically when no API key is configured.

## Logging Adapter

`clite` uses a `pino`-backed adapter that targets the core `BasicLogger` contract:

- CLI runtime passes `logger` directly into local `@cline/core` sessions.
- RPC-backed sessions include a serialized logger payload in `RpcChatStartSessionRequest.logger`; the RPC runtime reconstructs the same `pino` settings and injects them into core.
- Hosts can attach stable runtime logger bindings (for example `clientId`, `clientType`, `clientApp`) through `RpcChatRuntimeLoggerConfig.bindings`.
- `clite rpc register` and `clite rpc start` emit activation/registration log records so startup ownership is visible in logs.
- Logger behavior is consistent between local and RPC runtime execution paths while preserving a transport-safe config boundary.

After login, OAuth credentials are persisted with `auth.expiresAt`, and `@cline/core` refreshes these tokens automatically during session turns (including long-lived RPC runtime sessions).

On startup, `clite` also attempts a legacy settings import:

- Source files: `<CLINE_DATA_DIR>/globalState.json` and `<CLINE_DATA_DIR>/secrets.json`
- Target file: `<CLINE_DATA_DIR>/settings/providers.json` (or `CLINE_PROVIDER_SETTINGS_PATH`)
- Existing providers in `providers.json` are never overwritten
- Missing providers discovered in legacy files are merged into `providers.json`
- Migrated provider entries are annotated with `tokenSource: "migration"`

Custom provider registry notes:

- Provider runtime settings continue to persist in `<CLINE_DATA_DIR>/settings/providers.json`.
- User-added OpenAI-compatible provider model catalogs are persisted in `<CLINE_DATA_DIR>/settings/models.json` (or alongside `CLINE_PROVIDER_SETTINGS_PATH`).
- `models.json` stores model lists by provider ID and is loaded by RPC runtime provider actions.

## Features

- **Streaming output** - Responses stream in real-time
- **Stable stream rendering** - Prefers structured agent events and avoids duplicate text/tool output when chunk mirrors are also emitted
- **Sub-agent spawning** - `spawn_agent` is available by default unless disabled
- **Recursive delegation** - Sub-agents spawned via `spawn_agent` also receive `spawn_agent` when spawn is enabled
- **Agent teams runtime** - Team tools (tasks/mailbox/mission log) are available by default unless disabled
- Team tools use strict single-action schemas (for example `team_create_task`, `team_send_message`, `team_create_outcome`) instead of `action` unions
- **Pipe support** - Accepts piped input for processing files
- **Interactive mode** - Multi-turn conversations
- **JSON output mode** - NDJSON records for run lifecycle, agent/team events, and final result (`--output json` / `--json`)
- **Minimal dependencies** - Fast startup time
- **Multiple providers** - Works with Anthropic, OpenAI, and more

## Runtime Ownership

- CLI renders runtime events and handles terminal UX.
- Core owns agent creation, runtime composition, and session message persistence.
- CLI does not directly instantiate `Agent` for chat/task execution.
- CLI does not perform direct file/db message persistence in run/interactive paths.
- CLI owns the user-instruction watcher (rules/workflows/skills) because prompt assembly uses rule context before session start; the watcher is disposed on all exit paths.
- RPC runtime uses the same prompt resolver and accepts optional `rules` in runtime config (or `systemPrompt` when fully prebuilt by the caller).
