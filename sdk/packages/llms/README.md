# @cline/llms

Package-level docs are centralized:

- Overview: [`packages/README.md`](../README.md)
- Architecture and interactions: [`packages/ARCHITECTURE.md`](../ARCHITECTURE.md)

`@cline/llms` remains the canonical source for model/provider cataloging and provider settings schema.

## Runtime entrypoints

- Default package entrypoint: `@cline/llms`
- Node/runtime explicit entrypoint: `@cline/llms/node`

The default export map resolves to a browser-safe bundle under browser/react-server conditions, and to the Node runtime bundle under standard Node import conditions.

Vertex Claude routing in the Node runtime uses `@ai-sdk/google-vertex/anthropic`.

## Provider Runtime Notes

- Provider IDs and alias normalization (for example, `openai` -> `openai-native`) are centralized in `src/providers/types/provider-ids.ts` and reused across provider auth, handler factory routing, and app call sites.
- `openai-codex`, `claude-code`, `opencode`, and Vertex Claude routes share a common AI SDK runtime bridge (`handlers/ai-sdk-community.ts`) for message mapping and stream normalization.
- `openai-codex`, `claude-code`, and `opencode` are consolidated in `handlers/community-sdk.ts` and share a common SDK-backed handler base (`handlers/ai-sdk-provider-base.ts`) for provider loading, model resolution, and stream wiring.
- Tests for Claude Code and OpenCode community handlers are consolidated in `handlers/community-sdk.test.ts`.
- `providerId: "openai-codex"` uses `ai-sdk-provider-codex-cli` (Codex CLI), not OpenCode.
- Codex CLI executes its own tools; AI SDK custom tool schemas are ignored for this provider path.
- OAuth-backed `openai-codex` settings do not force `OPENAI_API_KEY`; only explicit OpenAI API keys (`sk-...`) map to Codex CLI env.
- `openai-codex` retains a catalog `baseUrl` only for provider-registry inclusion; runtime requests are handled by `CodexHandler`.
- In Bun + Zod v3 workspaces, `CodexHandler` applies a runtime compatibility shim for `ai-sdk-provider-codex-cli` schema loading.
- `providerId: "opencode"` uses the OpenCode provider (`ai-sdk-provider-opencode-sdk`).
- `opencode` ignores AI SDK custom tool schemas; tools are executed provider-side.
- `providerId: "claude-code"` uses `ai-sdk-provider-claude-code`, defaults to `sonnet`, and supports `sonnet`, `opus`, `haiku`.
- Set `AI_SDK_LOG_WARNINGS=false` to suppress AI SDK warning logs.
- Provider settings `headers` must be a string-to-string map (`Record<string, string>`).
- Stream chunks are modeled as discriminated unions (`ApiStreamChunk`); tests should narrow by `type` instead of casting to generic records.
