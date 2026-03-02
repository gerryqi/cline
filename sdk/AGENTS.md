---
description: Contributor and agent guide for the Cline packages workspace (Bun + TypeScript + Biome + Vitest).
globs: "*.ts,*.tsx,*.js,*.jsx,*.json,*.md"
alwaysApply: true
---

## Scope

This repository is a Bun workspace with four packages:

- `llms` (`@cline/llms`)
- `agents` (`@cline/agents`)
- `core` (`@cline/core`)
- `cli` (`@cline/cli`)

Primary goal: keep package boundaries clear and validate changes with typecheck, tests, and Biome.

## Current Stack (Source of Truth)

- Runtime/tooling: Bun workspaces and scripts
- Language/module format: TypeScript + ESM
- Lint/format: Biome (`biome.json`)
- Testing: Vitest in all packages (`llms`, `agents`, `core`, `cli`)
- Build: package-local Bun build/tsc scripts from root workspace scripts

Do not write new tests with `bun:test` in this repo. Use Vitest.

## Root Commands

- Install deps: `bun install`
- Build all packages: `bun run build`
- Build one package: `bun run build:llms|build:agents|build:core|build:cli`
- Regenerate model metadata: `bun run build:models`
- Run CLI from source: `bun run dev:cli -- "<prompt>"`
- Typecheck all packages: `bun run typecheck`
- Run all tests: `bun run test`
- Run package tests: `bun run test:llms|test:agents|test:core|test:cli`
- Lint + formatter check: `bun run check`
- Lint only: `bun run lint`
- Format check only: `bun run format`
- Apply fixes: `bun run fix`

## Testing Rules (Vitest)

- Use `vitest` APIs (`import { describe, it, expect } from "vitest"`).
- Prefer colocated `*.test.ts` files near the code under test.
- Use root scripts to run full test matrix before merging.
- `cli` has separate unit/e2e targets; run from `cli/`:
- `bun run test:unit` and `bun run test:e2e`

## Package Map

- `llms/`: provider/model cataloging and handler creation
- `agents/`: agent loop, tools, hooks, and multi-agent/team primitives
- `core/`: runtime composition, sessions, storage, orchestration
- `cli/`: executable app wiring `llms + agents + core`

When debugging end-to-end behavior, start at `cli/src/index.ts`, then follow into `core`, `agents`, and `llms`.

## Code Style and Hygiene

- Follow Biome defaults in `biome.json` (tabs, double quotes, recommended rules).
- Prefer minimal, focused diffs; avoid unrelated refactors.
- Keep exported package APIs stable unless the change explicitly targets API behavior.
- Update docs when changing scripts, workflows, or package responsibilities.

## Bun APIs (Use Last, Only When Needed)

- Use Bun as the script/runtime layer (`bun run`, `bun build`, `bunx`).
- Bun-specific APIs are allowed when they simplify implementation, but align with existing code first.
- Do not replace established dependencies without intent (example: current storage uses `better-sqlite3` in `core`/`cli`).
- If adding Bun runtime APIs (for example `Bun.serve`, `Bun.file`, `Bun.$`), keep usage isolated and document why Bun-specific behavior is required.
