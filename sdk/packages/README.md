# Packages Overview

This directory is the single documentation source for package-level responsibilities.

- High-level package roles: this file (`packages/README.md`)
- Package interaction and runtime flows: `packages/ARCHITECTURE.md`

## Package Responsibilities

| Package | Primary responsibility | Typical consumers | Internal deps |
| --- | --- | --- | --- |
| `@cline/shared` | Cross-package shared primitives (path resolution, session common types, indexing helpers) | `@cline/agents`, `@cline/core`, `@cline/rpc`, apps | None |
| `@cline/llms` | Model catalog + provider settings schema + handler creation SDK | `@cline/agents`, `@cline/core`, apps | None |
| `@cline/agents` | Stateless agent runtime loop (tools, hooks, extensions, teams, streaming) | `@cline/core`, apps | `@cline/llms`, `@cline/shared` |
| `@cline/rpc` | gRPC session/task/event/tool-approval gateway (server + client) | `@cline/core`, apps | `@cline/shared` |
| `@cline/core` | Stateful runtime orchestration (session lifecycle, storage, runtime composition, RPC adapter) | CLI/Desktop apps | `@cline/agents`, `@cline/llms`, `@cline/rpc`, `@cline/shared` |

## How Packages Work Together

1. `@cline/llms` defines model/provider capabilities and builds concrete handlers.
2. `@cline/agents` runs the agent loop on top of those handlers and tool execution primitives.
3. `@cline/core` composes runtime behavior with persistent sessions/storage and optional RPC-backed session services.
4. `@cline/rpc` exposes cross-process/session orchestration APIs when runtime and control-plane need decoupling.
5. `@cline/shared` provides the shared contracts and path/session primitives used across the stack.

## Practical Boundary Rules

- Put provider/model schema, cataloging, and handler wiring in `@cline/llms`.
- Put loop/tool/hook/team execution behavior in `@cline/agents`.
- Put persistence, session lifecycle, and runtime assembly in `@cline/core`.
- Put network session routing and approval/event transport in `@cline/rpc`.
- Put cross-package utility types and path/session constants in `@cline/shared`.

## Runtime Entry Points

- Node-oriented imports: `@cline/<pkg>/node`
- Browser entry points exist for API compatibility; some packages intentionally throw in browser mode for server-only features (`agents`, `core`, `rpc`).
- `@cline/core/server/node` contains server-side runtime/session services.

## Notes for Doc Consolidation

Nested package `README.md` and `ARCHITECTURE.md` files can be reduced or removed after references are updated to point here.
