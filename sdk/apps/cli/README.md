# Cline Cli Lite

Fast CLI for running agentic loops with LLMs. Streams output in real time and includes built-in tools, sub-agent spawning, and team runtime support by default.

Lifecycle note: active runs now install both `SIGINT` and `SIGTERM` abort handlers, and CLI runtime/session managers are disposed on shutdown paths to reduce orphaned subprocesses.

## Installation

```bash
npm i -g @cline/cli
# or
bun i -g @cline/cli
```

## Usage

```bash
# Single prompt
clite "What is 2+2?"
# Single-prompt runs are non-interactive and exit when the turn finishes

# Default run includes tools + spawn + teams
clite "Audit this package and propose fixes"

# Disable defaults explicitly
clite --no-tools --no-spawn --no-teams "Answer from general knowledge only"

# Require approval before each tool call
clite --require-tool-approval "Inspect and modify this repository"

# Require approval only for command execution
clite --tool-require-approval run_commands "Fix failing tests"

# Require approval for editor only
clite --tool-require-approval editor "Refactor src/index.ts for readability"

# With custom system prompt
clite -s "You are a pirate" "Tell me about the sea"

# Interactive mode
clite -i
# Running `clite` with no prompt also enters interactive mode.
# For one-shot auto-exit behavior, pass a prompt argument.
# Exit interactive mode with Ctrl+D (or Ctrl+C when idle).

# Pipe input
cat file.txt | clite "Summarize this"

# Show usage stats (tokens + estimated cost when available)
clite -u -t "Explain quantum computing"

# Stream structured NDJSON output
clite --output json "Summarize this repository"
# equivalent
clite --json "Summarize this repository"

# Refresh model catalog from provider endpoints for this run 
# to use a new model not available in the built-in model catalog yet 
clite --refresh-models -p cline -m "openai/gpt-10"

# Start the RPC gateway server (blocks until Ctrl+C)
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

# Register a client with the RPC gateway
clite rpc register --address 127.0.0.1:4317 --client-type desktop --client-id code-desktop
clite rpc register --meta app=code --meta host=tauri

# Authenticate OAuth providers explicitly
clite auth openai-codex
clite auth oca
clite auth cline

# Use persistent team state name
clite --team-name dev-team "Continue yesterday's team workflow"

# Use a specific provider, model, and access token for a single prompt/task
clite -p openrouter -m google/gemini-3-pro -k sk-your-google-gemini-api-key "Set up a storybook for the frontend react ui components"
```

## OAuth Authentication

`clite` supports OAuth login for:

- `cline`
- `openai-codex`
- `oca`

Use the explicit auth command:

```bash
clite auth <provider>
```

Examples:

```bash
clite auth cline
clite auth openai-codex
clite auth oca
```

When you run with one of these providers and no API key is available, `clite` will automatically start the OAuth login flow and persist credentials to provider settings.

During OAuth login, `clite` now tries to open the authorization URL in your default browser automatically and still prints the URL for manual fallback.

When running in interactive mode with `-p cline`, `clite` now prints an account banner before the model line when OAuth credentials are available, including:

- user email
- active account credit balance (organization balance when an organization is active, otherwise personal balance)
- active organization name (when an organization account is active)

## Options

| Flag | Description |
|------|-------------|
| `-s, --system <prompt>` | System prompt for the agent |
| `-m, --model <id>` | Model ID (default: provider's first model from bundled catalog; fallback `claude-sonnet-4-6`) |
| `-p, --provider <id>` | Provider ID (default: anthropic) |
| `-k, --key <api-key>` | API key override for this run |
| `-n, --max-iterations <n>` | Max agentic loop iterations (currently ignored; runtime is unbounded) |
| `-i, --interactive` | Interactive mode |
| `-u, --usage` | Show token usage and estimated cost (when available) |
| `-t, --timings` | Show timing info |
| `--thinking` | Enable model thinking/reasoning when supported |
| `--refresh-models` | Refresh model catalog from provider endpoints for this run |
| `--output <text|json>` | Output format (default: `text`) |
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
| `-h, --help` | Show help (exits immediately) |
| `-v, --version` | Show version (exits immediately) |

`--output json` is non-interactive and requires either a prompt argument or piped stdin.

Subcommands:

- `clite auth <provider>` - Run OAuth login for `cline`, `openai-codex`, or `oca`
- `clite rpc start` - Start the RPC gateway
- `clite rpc status` - Check whether the RPC gateway is healthy
- `clite rpc stop` - Request graceful shutdown of the RPC gateway
- `clite rpc ensure` - Ensure a compatible runtime-capable RPC server is available and return the effective address
- `clite rpc register` - Register a client id/type (+ optional metadata) with the RPC gateway
- `clite list ...` - List workflows/rules/skills/agents/history/hooks/mcp

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
- Runtime APIs: `clite rpc start` now wires server-side runtime handlers for `StartRuntimeSession`, `SendRuntimeSession`, and `AbortRuntimeSession` (used by `@cline/code` and CLI runtime actions)
- Runtime event bridge: runtime handlers publish live `runtime.chat.*` events via RPC `PublishEvent`, so subscribed clients can consume real-time text/tool updates through `StreamEvents`
- Runtime event contract: the bridge publishes `runtime.chat.*` from structured `agent_event` payloads emitted by core runtime sessions.
- CLI streaming: RPC-backed prompt runs subscribe to `runtime.chat.*` during each turn, so text/tool output is rendered incrementally in the terminal (not only at turn completion).
- Prompt startup behavior: regular `clite "<prompt>"` runs invoke `rpc ensure --json` first, adopt the ensured address for that process (`CLINE_RPC_ADDRESS`), and then use runtime RPC APIs.
- Regular `clite "<prompt>"` runs now use RPC runtime `StartRuntimeSession`/`SendRuntimeSession` when RPC is available, and fall back to in-process local runtime when RPC is unavailable.

## Development

```bash
# From the packages directory
bun install
bun run build

# Run CLI unit tests
bun -F @cline/cli test:unit

# Run CLI e2e tests
bun -F @cline/cli test:e2e

# Link the clite bin name
bun link

# Run from the linked binary
clite "your prompt"

# Run from source (dev)
bun run dev:cli -- "your prompt"

# Run built CLI with Node (no Bun runtime required for end users)
node cli/dist/index.js "your prompt"
```

## Publishing

```bash
npm publish --access public
```

After publishing, users can install globally with:

```bash
npm install -g @cline/cli
# with bun
bun install -g @cline/cli
```

## Environment Variables

- `ANTHROPIC_API_KEY` - API key for Anthropic
- `CLINE_DATA_DIR` - Base data directory for sessions/settings/teams/hooks
- `CLINE_SANDBOX` - Set to `1` to force sandbox mode
- `CLINE_SANDBOX_DATA_DIR` - Override sandbox state directory
- `CLINE_TEAM_DATA_DIR` - Override team persistence directory
- `CLINE_RPC_ADDRESS` - Address used by `clite rpc start` (default `127.0.0.1:4317`)
- `CLINE_TOOL_APPROVAL_MODE` - Approval mode (`desktop` uses file IPC; unset uses terminal prompt)
- `CLINE_TOOL_APPROVAL_DIR` - Directory for desktop approval request/decision files
- `OPENAI_API_KEY` - API key for OpenAI (when using `-p openai`)
- `OPENROUTER_API_KEY` - API key for OpenRouter

`--key` takes precedence over environment variables.

For OAuth providers (`cline`, `openai-codex`, `oca`), you can either use `clite auth <provider>` or let `clite` prompt for OAuth automatically when no API key is configured.

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
- `team_member` payload rules: `action=spawn` requires `agentId` + `rolePrompt`; `action=shutdown` requires `agentId`
- **Pipe support** - Accepts piped input for processing files
- **Interactive mode** - Multi-turn conversations
- **JSON output mode** - NDJSON records for run lifecycle, agent/team events, and final result (`--output json` / `--json`)
- **Minimal dependencies** - Fast startup time
- **Multiple providers** - Works with Anthropic, OpenAI, and more

## Source Layout

The CLI entrypoint delegates to focused modules so `src/index.ts` acts as orchestration glue:

- `src/commands/auth.ts` - OAuth provider normalization/login/persistence helpers
- `src/commands/hook.ts` - hook payload stdin handler and hook output formatting
- `src/commands/list.ts` - `clite list ...` command handlers
- `src/commands/rpc.ts` - `clite rpc start` lifecycle command
- `src/runtime/prompt.ts` - default system prompt and user-input enrichment builders
- `src/index.ts` - process/session lifecycle, streaming output, run loop orchestration

## Runtime Ownership

`clite` now routes both prompt and interactive flows through `@cline/core/server` `DefaultSessionManager`.

- CLI renders runtime events and handles terminal UX.
- Core owns agent creation, runtime composition, and session message persistence.
- CLI no longer directly instantiates `Agent` for chat/task execution.
- CLI does not perform direct file/db message persistence in run/interactive paths.
- CLI owns the user-instruction watcher (rules/workflows/skills) because prompt assembly uses rule context before session start; the watcher is disposed on all exit paths.

## Examples

```bash
# Quick question
clite "What's the capital of France?"

# Code review with piped input
cat src/index.ts | clite "Review this code for bugs"

# Creative writing with custom persona
clite -s "You are Shakespeare" "Write a sonnet about AI"

# Use a different model
clite -m claude-opus-4-20250514 "Explain string theory"

# Latest model metadata is loaded from models.dev automatically on startup
clite -p openai -m gpt-5 "Explain this codebase"

# Use a different provider and model with a specific access token for the provider
clite -p openrouter -m google/gemini-3-pro -k sk-your-google-gemini-api-key "Set up a storybook for the frontend react ui components"

# Explicit OAuth login for auth-capable providers
clite auth openai-codex

# Team workflow with persistent name
clite --team-name release-team "Plan, implement, and verify release checklist"
# Team state file is written after meaningful team activity only
# (fresh empty team sessions do not create state.json)

# Interactive coding session
clite -i -s "You are an expert Python developer"

# Parseable JSON output (NDJSON)
clite --json "List the key modules in this project"
```
