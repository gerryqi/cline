# Cline SDK Packages

This repository contains the SDK, CLI, and desktop app packages that power Cline-style agent runtimes.

It is organized as a Bun workspace with five main packages:

- `@cline/llms`: model/provider selection and handler creation
- `@cline/agents`: agent loop + tools + hooks + teams runtime primitives
- `@cline/core`: stateful orchestration, sessions, storage, runtime assembly
- `@cline/cli`: production CLI that composes the three SDK packages
- `@cline/desktop`: Tauri desktop app that embeds a Next.js UI and composes the SDK packages

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
bun run build
```

Useful workspace scripts (root `package.json`):

- `bun run build` - build SDK packages (`llms -> agents -> core`)
- `bun run build:apps` - build SDK packages plus app targets (`cli` + `desktop`)
- `bun run build:llms|build:agents|build:core|build:cli|build:desktop` - build one workspace package
- `bun run build:desktop` - build desktop web assets (`next build`)
- `bun run build:models` - regenerate model metadata in `llms`
- `bun run dev:cli -- "your prompt"` - run CLI from source
- `bun run dev` - build SDK packages, then launch desktop app (`tauri dev`)
- `bun run dev:desktop` - launch desktop app directly
- `bun run typecheck` - typecheck all packages
- `bun run clean` - remove build outputs across packages

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
- `bun run test:llms|test:agents|test:core|test:cli|test:desktop` - run tests for one package

Package-level scripts also expose Vitest directly (for example `test:watch`, and in `cli`, `test:unit` and `test:e2e`).

## Workspace Import Boundaries

Allowed cross-workspace imports:

- `@cline/llms`
- `@cline/agents`
- `@cline/core`
- `@cline/core/server` (intentional Node-runtime-only exception)

Disallowed:

- all other deep imports like `@cline/llms/*`, `@cline/agents/*`, `@cline/core/*` (except `@cline/core/server`)

The boundary check is enforced by `bun run check:boundaries`.

## Repository Structure

```text
.
├── README.md
├── package.json
├── llms/
│   ├── README.md
│   ├── ARCHITECTURE.md
│   ├── src/
│   │   ├── config.ts
│   │   ├── sdk.ts
│   │   ├── models/
│   │   └── providers/
│   └── scripts/
├── agents/
│   ├── README.md
│   ├── ARCHITECTURE.md
│   ├── DOC.md
│   └── src/
│       ├── agent.ts
│       ├── hooks.ts
│       ├── extensions.ts
│       ├── tools/
│       ├── teams/
│       └── default-tools/
├── core/
│   ├── README.md
│   └── src/
│       ├── auth/
│       ├── runtime/
│       ├── session/
│       ├── storage/
│       └── server/
├── cli/
    ├── README.md
    ├── Doc.md
    └── src/
        ├── index.ts
        └── utils/
└── desktop/
    ├── README.md
    ├── app/
    ├── src/
    └── src-tauri/
```

## Package Guide

### `llms/` (`@cline/llms`)

Purpose: config-driven LLM SDK.

Use this package to:

- define provider/model allowlists
- resolve model catalogs
- create provider handlers
- register custom provider/model extensions

Start with:

- `llms/README.md`
- `llms/ARCHITECTURE.md`
- `llms/src/sdk.ts`
- `llms/src/providers/index.ts`
- `llms/src/models/registry.ts`

### `agents/` (`@cline/agents`)

Purpose: runtime agent loop and tool/hook/team primitives.

Use this package to:

- run and continue agent loops
- define and execute tools
- intercept lifecycle with hooks/extensions
- coordinate sub-agents and teams

Start with:

- `agents/README.md`
- `agents/DOC.md` (API/export overview)
- `agents/ARCHITECTURE.md`
- `agents/src/agent.ts`
- `agents/src/tools/`
- `agents/src/teams/`

### `core/` (`@cline/core`)

Purpose: stateful orchestration layer over agents.

Use this package to:

- build runtime environments
- resolve credentials/config
- manage root + sub-session lifecycle
- persist state/transcripts via storage adapters

Start with:

- `core/README.md`
- `core/src/runtime/`
- `core/src/session/`
- `core/src/storage/`
- `core/src/server/`

### `cli/` (`@cline/cli`)

Purpose: executable reference implementation of the SDK stack.

Use this package to see how the SDK packages are composed in a real app:

- argument parsing + runtime config (`cli/src/index.ts`)
- provider/model refresh (`@cline/llms`)
- runtime assembly/session management (`@cline/core/server`)
- agent loop execution + tools + hooks (`@cline/agents`)

Docs:

- `cli/README.md` (usage-oriented)
- `cli/Doc.md` (deep command/features breakdown)

### `desktop/` (`@cline/desktop`)

Purpose: desktop reference app that wires the SDK packages into a local GUI.

The desktop package combines:

- Next.js frontend (`desktop/app`, `desktop/src`)
- Tauri host/runtime (`desktop/src-tauri`)
- shared SDK packages (`@cline/llms`, `@cline/agents`, `@cline/core`)

Common commands:

- from repo root: `bun run dev` (recommended; builds SDK packages first, then starts desktop dev)
- from repo root: `bun run dev:desktop` (starts desktop app directly)
- from `desktop/`: `bun run dev:web` (frontend-only Next.js dev server on port `3124`)
- from `desktop/`: `bun run build` (build web assets)
- from `desktop/`: `bun run build:binary` (build desktop binary with Tauri)
- from `desktop/`: `bun run typecheck`
- from `desktop/`: `bun run clean` (clears Next + Cargo artifacts)

## How Apps Compose `llms`, `agents`, and `core`

The CLI and desktop app are the clearest end-to-end examples in this repo.

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

Desktop entry points to follow:

- frontend: `desktop/app/` and `desktop/src/`
- tauri backend/runtime bridge: `desktop/src-tauri/src/main.rs`

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

const result = await agent.run("<user_input>Summarize this repository.</user_input>")
console.log(result.text)
```

## Navigation Tips

- Read each package `README.md` first, then `ARCHITECTURE.md`/`DOC.md` files.
- Follow imports from `cli/src/index.ts` and `desktop/src-tauri/src/main.rs` to understand package boundaries.
- Prefer `src/` for implementation and `dist/` only for built output verification.
- Start debugging integration behavior from `cli/src/index.ts`, then drill into `core/src/runtime`, `agents/src/agent.ts`, and `llms/src/sdk.ts`.
