# Cline Cli Lite

Fast CLI for running agentic loops with LLMs. Streams output in real time and includes built-in tools, sub-agent spawning, and team runtime support by default.

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

# Default run includes tools + spawn + teams
clite "Audit this package and propose fixes"

# Disable defaults explicitly
clite --no-tools --no-spawn --no-teams "Answer from general knowledge only"

# Require approval before each tool call
clite --require-tool-approval "Inspect and modify this repository"

# Require approval only for command execution
clite --tool-require-approval run_commands "Fix failing tests"

# With custom system prompt
clite -s "You are a pirate" "Tell me about the sea"

# Interactive mode
clite -i

# Pipe input
cat file.txt | clite "Summarize this"

# Show usage stats
clite -u -t "Explain quantum computing"

# Stream structured NDJSON output
clite --output json "Summarize this repository"
# equivalent
clite --json "Summarize this repository"

# Use persistent team state name
clite --team-name dev-team "Continue yesterday's team workflow"

# Use a specific provider, model, and access tokey for a single prompt/task
clite -p openrouter -m google/gemini-3-pro -k sk-your-google-gemini-api-key "Set up a storybook for the frontend react ui components"
```

## Options

| Flag | Description |
|------|-------------|
| `-s, --system <prompt>` | System prompt for the agent |
| `-m, --model <id>` | Model ID (default: provider's first model from live catalog; fallback `claude-sonnet-4-6`) |
| `-p, --provider <id>` | Provider ID (default: anthropic) |
| `-k, --key <api-key>` | API key override for this run |
| `-n, --max-iterations <n>` | Max agentic loop iterations (currently ignored; runtime is unbounded) |
| `-i, --interactive` | Interactive mode |
| `-u, --usage` | Show token usage |
| `-t, --timings` | Show timing info |
| `--thinking` | Enable model thinking/reasoning when supported |
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
| `-h, --help` | Show help |
| `-v, --version` | Show version |

`--output json` is non-interactive and requires either a prompt argument or piped stdin.

## Development

```bash
# From the packages directory
bun install
bun run build

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
- `CLINE_SANDBOX` - Set to `1` to force sandbox mode
- `CLINE_SANDBOX_DATA_DIR` - Override sandbox state directory
- `CLINE_TEAM_DATA_DIR` - Override team persistence directory
- `OPENAI_API_KEY` - API key for OpenAI (when using `-p openai`)
- `OPENROUTER_API_KEY` - API key for OpenRouter

`--key` takes precedence over environment variables.

## Features

- **Streaming output** - Responses stream in real-time
- **Sub-agent spawning** - `spawn_agent` is available by default unless disabled
- **Agent teams runtime** - Team tools (tasks/mailbox/mission log) are available by default unless disabled
- **Pipe support** - Accepts piped input for processing files
- **Interactive mode** - Multi-turn conversations
- **JSON output mode** - NDJSON records for run lifecycle, agent/team events, and final result (`--output json` / `--json`)
- **Minimal dependencies** - Fast startup time
- **Multiple providers** - Works with Anthropic, OpenAI, and more

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

# Team workflow with persistent name
clite --team-name release-team "Plan, implement, and verify release checklist"

# Interactive coding session
clite -i -s "You are an expert Python developer"

# Parseable JSON output (NDJSON)
clite --json "List the key modules in this project"
```
