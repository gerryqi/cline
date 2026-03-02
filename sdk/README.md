# Cline SDK Packages

This repository contains the SDK and CLI packages that power Cline-style agent runtimes.

It is organized as a Bun workspace with four main packages:

- `@cline/llms`: model/provider selection and handler creation
- `@cline/agents`: agent loop + tools + hooks + teams runtime primitives
- `@cline/core`: stateful orchestration, sessions, storage, runtime assembly
- `@cline/cli`: production CLI that composes the three SDK packages

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

- `bun run build` - install dependencies and build all packages (`llms -> agents -> core -> cli`)
- `bun run build:llms|build:agents|build:core|build:cli` - build one workspace package
- `bun run build:models` - regenerate model metadata in `llms`
- `bun run dev:cli -- "your prompt"` - run CLI from source
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

All packages in this workspace use Vitest for testing (`llms`, `agents`, `core`, and `cli`).

- `bun run test` - run all package test suites from the repo root
- `bun run test:llms|test:agents|test:core|test:cli` - run tests for one package

Package-level scripts also expose Vitest directly (for example `test:watch`, and in `cli`, `test:unit` and `test:e2e`).

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
└── cli/
    ├── README.md
    ├── Doc.md
    └── src/
        ├── index.ts
        └── utils/
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
- provider/model refresh (`@cline/llms/providers`)
- runtime assembly/session management (`@cline/core/server`)
- agent loop execution + tools + hooks (`@cline/agents`)

Docs:

- `cli/README.md` (usage-oriented)
- `cli/Doc.md` (deep command/features breakdown)

## How CLI Composes `llms`, `agents`, and `core`

The CLI is the clearest end-to-end example in this repo.

Flow:

1. `@cline/llms`:
   - fetches provider model metadata (`getLiveModelsCatalog`)
   - picks provider/model defaults for the current run
2. `@cline/core`:
   - builds runtime environment (`DefaultRuntimeBuilder`)
   - composes team runtime/session-oriented behavior
3. `@cline/agents`:
   - constructs tools (`createBuiltinTools`, spawn tool helpers)
   - creates and runs the `Agent` loop (`agent.run`, `agent.continue`)
   - processes tool calls/hooks/streaming events

Minimal composition sketch:

```ts
import { Agent, createBuiltinTools } from "@cline/agents"
import { DefaultRuntimeBuilder } from "@cline/core/server"
import { getLiveModelsCatalog } from "@cline/llms/providers"

const catalog = await getLiveModelsCatalog()
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
- Follow imports from `cli/src/index.ts` to understand package boundaries.
- Prefer `src/` for implementation and `dist/` only for built output verification.
- Start debugging integration behavior from `cli/src/index.ts`, then drill into `core/src/runtime`, `agents/src/agent.ts`, and `llms/src/sdk.ts`.
