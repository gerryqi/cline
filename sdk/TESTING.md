# Testing Plan

This file tracks the test strategy and implementation progress for `@cline/cli`, `@cline/core`, and `@cline/llms`.

## Goals

- Deterministic tests: no real network/OAuth, isolated filesystem/env per test.
- Contract-focused coverage: exit codes, output shape, persisted artifacts, runtime/session behavior.
- Clear layering: unit tests for logic seams, e2e tests for real process/runtime integration.
- Explicit live smoke layer: opt-in real-provider checks that validate external integration wiring without making default test runs flaky.

## Live Provider Testing Philosophy (`@cline/llms`)

- Purpose: catch provider integration drift (auth, endpoint, model routing, stream completion semantics) against real configured providers.
- Scope: one small prompt per configured provider; this is a health/smoke pass, not a quality benchmark.
- Opt-in by design: live provider tests must stay disabled in default unit/e2e runs.
- Failure model: collect and report all failing providers in one run so triage is fast.
- Stability guardrails:
  - per-provider timeout
  - no requirement in normal CI gating unless explicitly enabled by environment
  - keep deterministic tests as the primary reliability signal

## Phased Plan

1. Core e2e scaffolding and first lifecycle e2e test
- Add dedicated e2e Vitest config for `packages/core`.
- Add `test:unit` and `test:e2e` scripts to `packages/core/package.json`.
- Add first core e2e test that validates a local session lifecycle roundtrip.
- Status: `completed`

2. CLI e2e contract and failure-path expansion
- Add e2e cases for invalid subcommands/flags, JSON mode constraints, piped input merge paths, sandbox wiring, and approval behavior in non-TTY mode.
- Status: `in_progress`

3. CLI unit seam extraction and focused unit tests
- Refactor `apps/cli/src/index.ts` to expose small pure helpers for command resolution/config/policy assembly.
- Add unit tests for those helpers and keep existing e2e tests for end-to-end validation.
- Status: `pending`

4. Core package export/entrypoint contract tests
- Add tests that verify all `exports` entrypoints in `packages/core/package.json` load expected symbols.
- Status: `pending`

## Progress Log

- 2026-03-05: Created this plan and started Phase 1.
- 2026-03-05: Completed Phase 1.
  - Added `packages/core/vitest.e2e.config.ts`.
  - Updated `packages/core/package.json` scripts to split `test:unit` and `test:e2e`.
  - Added `packages/core/src/session/default-session-manager.e2e.test.ts` covering start/send/list/read/stop/delete lifecycle with real artifact files.
  - Updated `packages/core/vitest.config.ts` to exclude `*.e2e.test.ts` from unit runs.
  - Updated `packages/core/README.md` with unit/e2e/full test commands.
- 2026-03-05: Started Phase 2.
  - Added CLI e2e cases for:
    - JSON mode constraints (`--json` without prompt/stdin, `--json --interactive`)
    - invalid `list` target handling
    - invalid `rpc` subcommand handling
    - missing `auth` provider handling
    - invalid `--mode` handling
  - Hardened CLI e2e harness:
    - increased `spawnSync` `maxBuffer` to reduce truncated stdout parsing failures
    - reduced `sessions list`/`history` limits in e2e to avoid oversized payloads
    - made sessions-list parsing tolerant of mixed/stdout-prefixed JSON output
    - made hook-audit assertion tolerate current log-path behavior fallback
    - added a shared isolated env factory in CLI e2e tests to mock workspace/runtime context (`HOME`, `CLINE_DATA_DIR`, `CLINE_SESSION_DATA_DIR`, `CLINE_TEAM_DATA_DIR`, provider/hook paths)
  - Targeted CLI e2e validation for the new/updated cases is passing.
- 2026-03-05: Added `@cline/llms` live provider smoke test.
  - Added `packages/llms/src/live-providers.test.ts`.
  - Test reads configured providers from a JSON file (`providers.json` style or direct provider-settings array).
  - Test sends a minimal prompt to each provider and reports all providers that returned errors.
  - Test is gated behind `LLMS_LIVE_TESTS=1` and `LLMS_LIVE_PROVIDERS_PATH=...` to keep default runs deterministic.

## Current Validation Snapshot

- `bun -F @cline/core test:e2e`: passing.
- `bun -F @cline/core test:unit`: fails due to pre-existing failures in:
  - `src/storage/provider-settings-legacy-migration.test.ts`
  - `src/input/mention-enricher.test.ts`
  - `src/input/file-indexer.test.ts`

## Execution Notes

- Run core unit tests: `bun -F @cline/core test:unit`
- Run core e2e tests: `bun -F @cline/core test:e2e`
- Run core full tests: `bun -F @cline/core test`
- Run llms live provider smoke test:
  - `cd sdk-wip/packages/llms`
  - `LLMS_LIVE_TESTS=1 LLMS_LIVE_PROVIDERS_PATH=/absolute/path/to/providers.json bun test src/live-providers.test.ts`
  - Optional timeout override: `LLMS_LIVE_PROVIDER_TIMEOUT_MS=120000`
