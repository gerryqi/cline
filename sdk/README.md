# Cline SDK Packages

This repository contains the SDK packages that power Cline agent runtimes.

Contributor onboarding and architecture guidance is centralized in [`AGENTS.md`](/Users/beatrix/dev/clinee/sdk-wip/AGENTS.md).

It is organized as a Bun workspace with four SDK packages and three app targets:

SDK packages (`packages/`):

- `@cline/llms`: model/provider selection and handler creation
- `@cline/agents`: agent loop + tools + hooks + teams runtime primitives
- `@cline/rpc`: gRPC routing server for clients, sessions, tasks, and tool approvals
- `@cline/core`: stateful orchestration, sessions, storage, runtime assembly

Apps built with the Cline SDK (`apps/`):

- `@cline/cli`: Lightweight CLI that composes the SDK packages
- `@cline/code`: Tauri desktop app that embeds a Next.js UI and composes the SDK packages
- `@cline/desktop`: Tauri desktop app that embeds a Next.js UI and composes the SDK packages

`@cline/code` OAuth provider sign-in:

- Clicking a provider in settings opens its configuration view.
- Provider settings now load from `@cline/llms` provider registry IDs (instead of static seed data).
- Provider model lists are lazy loaded per provider when the detail panel is opened/refreshed.
- OAuth providers (`Cline`, `OCA`, `OpenAI Codex`) expose a `Login via Browser` action in the provider API key section.
- OAuth credentials are persisted by core storage in `~/.cline/data/settings/providers.json` through `ProviderSettingsManager`.
- Manual updates to provider fields in settings (toggle, API key, base URL) are persisted to the same provider settings file.
- In the `@cline/code` UI, selecting `Settings` from the left sidebar switches to `SettingsView`; closing settings returns to chat.
- Provider IDs from `@cline/llms` must be unique because they are used as React list keys and provider state identifiers.
- Chat model selection now remembers the last selected `modelId` per `providerId` in local app storage and restores it when switching providers or starting a new chat session.
- Chat provider/model selectors now prioritize providers enabled in settings (`list_provider_catalog`) and show models for those enabled providers; if provider settings are unavailable, selectors fall back to the full local catalog.
- Chat transcript tool entries now show expandable `Input` and `Result` payload sections in `apps/code/components/chat-messages.tsx`, including persisted `tool_result` payloads stored as JSON strings.
- Hydrated/reopened chat sessions continue applying live websocket `chat_event` updates (assistant text + tool events) even when no pre-seeded `activeAssistantMessageId` exists.

`@cline/code` MCP server settings:

- The `Settings -> MCP Servers` screen reads and writes the same MCP settings file used by CLI.
- Default path: `~/.cline/data/settings/cline_mcp_settings.json`
- Override path: `CLINE_MCP_SETTINGS_PATH`
- Supported actions in UI: list, enable/disable, add/edit, delete MCP server registrations, and open the config file from the path/button in settings.

`@cline/code` Rules settings lists:

- The `Settings -> Rules` screen now loads real config data through the CLI list pipeline (`list rules|workflows|skills|agents|hooks --json`).
- Tabs in this screen: `Rules`, `Workflows`, `Hooks`, `Skills`, and `Agents`.
- CLI list discovery for this screen resolves from the app `workspace_root` (not the Tauri process cwd).
- Data shown is read-only discovery output with file paths and summaries, plus refresh and partial-result warnings when any list source fails.

`@cline/code` core logger streaming:

- `apps/code/scripts/chat-runtime-bridge.ts` forwards runtime log/error chunks to Tauri as `chat_core_log` stream events.
- `apps/code/hooks/use-chat-session.ts` listens for `chat_core_log` and prints them with `console.debug|info|warn|error`.
- Keep regular `stdout` output in `chat-runtime-bridge.ts` JSON-only; emitting plain `console.log` there can corrupt stream parsing.

`@cline/code` + `@cline/desktop` shared chat runtime bridge design:

- Both app hosts use one persistent `chat-runtime-bridge.ts` process per app (`apps/code/scripts/chat-runtime-bridge.ts`, `apps/desktop/scripts/chat-runtime-bridge.ts`).
- Bridge command/control is shared via `@cline/rpc` `runRpcRuntimeCommandBridge(...)`.
- Bridge stream subscription handling remains shared via `@cline/rpc` runtime chat helpers.

## Prerequisites

Install these before working in this repo:

- `git` (version control and cloning)
- `bun` (workspace install/build/test runner)
  - https://bun.com/docs/installation
- `node` (required target runtime for built CLI artifacts)

Verify:

```bash
git --version
bun --version
node --version
```

## Quick Start

```bash
# from repo root
bun install
# Build all the SDK packages
bun run build
# Build all the apps
bun run build:apps
```

Useful workspace scripts (root `package.json`):

- `bun run build` - build SDK packages (`llms -> agents -> rpc -> core`)
- `bun run build:apps` - build app targets (`cli` + `desktop` + `code`)
- `bun run build:llms|build:agents|build:rpc|build:core|build:cli|build:code|build:desktop` - build one workspace package
- `bun run build:models` - regenerate model metadata in `llms`
- `bun run dev:cli -- "your prompt"` - run CLI from source (direct entrypoint, no workspace log prefixing)
- `bun run dev` - build SDK packages + CLI, then launch code app (`tauri dev`)
- `bun run dev:code` - launch code app directly
- `bun run dev:desktop` - launch desktop app directly
- `bun run typecheck` - typecheck all packages
- `bun run clean` - remove build outputs across packages

Development note:
- SDK packages now support source-first development resolution without rebuilding `dist`:
  - `@cline/core`, `@cline/agents`, and `@cline/llms` `typecheck` scripts use `tsconfig.dev.json` path aliases to sibling `packages/*/src`.
  - SDK package `exports` now include a `development` condition that points to `src` entrypoints.
  - Root dev scripts run Bun with `--conditions=development` (`dev:cli`, `dev:code`, `dev:desktop`) so runtime imports pick up live workspace source changes.

## Linting and Formatting (Biome)

This repo uses [Biome](https://biomejs.dev/) for both linting and formatting from the root workspace scripts:

- `bun run check` - run Biome checks across the repo
- `bun run lint` - run lint-only checks
- `bun run format` - run formatter (without writing changes)
- `bun run fix` - apply safe Biome fixes and formatting with `--write`

Tip: run `bun run fix` before opening a PR, then `bun run check` to verify everything passes cleanly.

## Testing (Vitest)

SDK/CLI packages in this workspace use Vitest for testing (`llms`, `agents`, `core`, and `cli`).

- `bun run test` - run all package test suites from the repo root
- `bun run test:llms|test:agents|test:core|test:cli` - run tests for one package

Package-level scripts also expose Vitest directly (for example `test:watch`, and in `cli`, `test:unit` and `test:e2e`).

Detailed testing strategy (including CLI e2e execution flow, current e2e coverage, and e2e-vs-unit guidance) is documented in `TESTING.md`.

## Workspace Import Boundaries

Allowed cross-workspace imports:

- `@cline/llms`
- `@cline/agents`
- `@cline/rpc`
- `@cline/core`
- `@cline/core/server` (intentional Node-runtime-only exception)

Disallowed:

- all other deep imports like `@cline/llms/*`, `@cline/agents/*`, `@cline/core/*` (except `@cline/core/server`)

The boundary check is enforced by `bun run check:boundaries`.

## Repository Structure

```text
.
├── README.md
├── AGENTS.md
├── package.json
├── biome.json
├── packages/
│   ├── llms/
│   │   ├── README.md
│   │   ├── ARCHITECTURE.md
│   │   └── src/
│   │       ├── index.ts
│   │       ├── catalog.ts
│   │       ├── config.ts
│   │       ├── sdk.ts
│   │       ├── types.ts
│   │       ├── models/
│   │       └── providers/
│   ├── agents/
│   │   ├── README.md
│   │   ├── ARCHITECTURE.md
│   │   ├── DOC.md
│   │   └── src/
│   │       ├── index.ts
│   │       ├── agent.ts
│   │       ├── hooks.ts
│   │       ├── extensions.ts
│   │       ├── streaming.ts
│   │       ├── message-builder.ts
│   │       ├── tools/
│   │       ├── default-tools/
│   │       ├── teams/
│   │       └── prompts/
│   ├── rpc/
│   │   ├── README.md
│   │   └── src/
│   │       ├── index.ts
│   │       ├── client.ts
│   │       ├── gateway-client.ts
│   │       ├── server.ts
│   │       ├── session-store.ts
│   │       └── proto/
│   └── core/
│       ├── README.md
│       └── src/
│           ├── index.ts
│           ├── types/
│           ├── runtime/
│           ├── session/
│           ├── storage/
│           ├── agents/
│           ├── adapters/
│           ├── auth/
│           ├── input/
│           ├── chat/
│           └── server/
└── apps/
    ├── cli/
    │   ├── README.md
    │   ├── ARCHITECTURE.md
    │   └── src/
    │       ├── index.ts
    │       └── utils/
    ├── code/
    │   ├── app/
    │   ├── components/
    │   ├── hooks/
    │   ├── lib/
    │   ├── styles/
    │   ├── public/
    │   └── src-tauri/
    └── desktop/
        ├── README.md
        ├── ARCHITECTURE.md
        ├── app/
        ├── components/
        ├── hooks/
        ├── lib/
        ├── styles/
        ├── public/
        └── src-tauri/
```

## Package Guide

### `packages/llms` (`@cline/llms`)

Purpose: config-driven LLM SDK.

Use this package to:

- define provider/model allowlists
- resolve model catalogs
- create provider handlers
- register custom provider/model extensions

Start with:

- `packages/llms/README.md`
- `packages/llms/ARCHITECTURE.md`
- `packages/llms/src/sdk.ts`
- `packages/llms/src/providers/index.ts`

### `packages/agents` (`@cline/agents`)

Purpose: runtime agent loop and tool/hook/team primitives.

Use this package to:

- run and continue agent loops
- define and execute tools
- intercept lifecycle with hooks/extensions
- coordinate sub-agents and teams

Start with:

- `packages/agents/README.md`
- `packages/agents/DOC.md` (API/export overview)
- `packages/agents/ARCHITECTURE.md`
- `packages/agents/src/agent.ts`
- `packages/agents/src/tools/`
- `packages/agents/src/teams/`

### `packages/rpc` (`@cline/rpc`)

Purpose: gRPC gateway for routing clients, sessions, tasks, and tool approvals.

Use this package to:

- start and connect to a local gRPC server (default `127.0.0.1:4317`)
- register clients and manage session lifecycle
- enqueue and claim spawn requests for sub-agents
- stream events and handle tool approval flows

Start with:

- `packages/rpc/README.md`
- `packages/rpc/src/server.ts`
- `packages/rpc/src/client.ts`
- `packages/rpc/src/proto/rpc.proto`

### `packages/core` (`@cline/core`)

Purpose: stateful orchestration layer over agents.

Use this package to:

- build runtime environments
- resolve credentials/config
- manage root + sub-session lifecycle
- persist state/transcripts via storage adapters
- load agent configs, rules, and workflows

Start with:

- `packages/core/README.md`
- `packages/core/src/runtime/`
- `packages/core/src/session/`
- `packages/core/src/storage/`
- `packages/core/src/agents/`
- `packages/core/src/server/`

### `apps/cli` (`@cline/cli`)

Purpose: executable reference implementation of the SDK stack.

Use this package to see how the SDK packages are composed in a real app:

- argument parsing + runtime config (`apps/cli/src/index.ts`)
- provider/model refresh (`@cline/llms`)
- runtime assembly/session management (`@cline/core/server`)
- agent loop execution + tools + hooks (`@cline/agents`)
- gRPC server mode (`clite rpc start`) (`@cline/rpc`)

Docs:

- `apps/cli/README.md` (usage-oriented)
- `apps/cli/ARCHITECTURE.md`

### `apps/code` (`@cline/code`)

Purpose: Tauri desktop app that wires the SDK packages into a local GUI.

The code app combines:

- Next.js frontend (`apps/code/app`, `apps/code/components`)
- Tauri host/runtime (`apps/code/src-tauri`)
- shared SDK packages (`@cline/llms`, `@cline/agents`, `@cline/core`)

Common commands:

- from repo root: `bun run dev` (recommended; builds SDK packages + CLI first, then starts code app dev)
- from repo root: `bun run dev:code` (starts code app directly)
- from `apps/code/`: `bun run dev:web` (frontend-only Next.js dev server on port `3125`)
- from `apps/code/`: `bun run build` (build web assets)
- from `apps/code/`: `bun run build:binary` (build desktop binary with Tauri)

### `apps/desktop` (`@cline/desktop`)

Purpose: desktop reference app that wires the SDK packages into a local GUI.

The desktop package combines:

- Next.js frontend (`apps/desktop/app`, `apps/desktop/components`)
- Tauri host/runtime (`apps/desktop/src-tauri`)
- shared SDK packages (`@cline/llms`, `@cline/agents`, `@cline/core`)

Common commands:

- from repo root: `bun run dev:desktop` (starts desktop app directly)
- from `apps/desktop/`: `bun run dev:web` (frontend-only Next.js dev server on port `3124`)
- from `apps/desktop/`: `bun run build` (build web assets)
- from `apps/desktop/`: `bun run build:binary` (build desktop binary with Tauri)
- from `apps/desktop/`: `bun run typecheck`
- from `apps/desktop/`: `bun run clean` (clears Next + Cargo artifacts)

## How Apps Compose `llms`, `agents`, `rpc`, and `core`

The CLI and desktop apps are the clearest end-to-end examples in this repo.

Flow:

1. `@cline/llms`:
   - fetches provider model metadata (`providers.getLiveModelsCatalog`)
   - picks provider/model defaults for the current run
2. `@cline/core`:
   - builds runtime environment (`DefaultRuntimeBuilder`)
   - composes team runtime/session-oriented behavior
3. `@cline/agents`:
   - constructs tools (`createBuiltinTools`, spawn tool helpers)
   - creates and runs the `Agent` loop (`agent.run`, `agent.continue`)
   - processes tool calls/hooks/streaming events
4. `@cline/rpc` (optional):
   - provides gRPC server for multi-client session routing
   - manages tool approval flows and event streaming

Desktop/code entry points to follow:

- frontend: `apps/code/app/` or `apps/desktop/app/`
- tauri backend/runtime bridge: `apps/code/src-tauri/` or `apps/desktop/src-tauri/`

Minimal composition sketch:

```ts
import { Agent, createBuiltinTools } from "@cline/agents"
import { DefaultRuntimeBuilder } from "@cline/core/server"
import { providers } from "@cline/llms"

const catalog = await providers.getLiveModelsCatalog()
const providerId = "anthropic"
const modelId = catalog[providerId]?.[0]?.id ?? "claude-sonnet-4-6"

const runtime = new DefaultRuntimeBuilder().build({
	config: { providerId, modelId, cwd: process.cwd(), enableTools: true },
})

const agent = new Agent({
	providerId,
	modelId,
	systemPrompt: "You are a helpful coding assistant.",
	tools: runtime.tools.length ? runtime.tools : createBuiltinTools({ cwd: process.cwd() }),
})

const result = await agent.run("<user_input mode="mode">Summarize this repository.</user_input>")
console.log(result.text)
```

## Navigation Tips

- Start with [`AGENTS.md`](/Users/beatrix/dev/clinee/sdk-wip/AGENTS.md) for onboarding + architecture, then read package `README.md` files and any package `DOC.md` details.
- Follow imports from `apps/cli/src/index.ts` and `apps/desktop/src-tauri/src/main.rs` to understand package boundaries.
- Prefer `src/` for implementation and `dist/` only for built output verification.
- Start debugging integration behavior from `apps/cli/src/index.ts`, then drill into `packages/core/src/runtime`, `packages/agents/src/agent.ts`, and `packages/llms/src/sdk.ts`.
