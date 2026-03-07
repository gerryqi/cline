# @cline/llms

Package-level docs are centralized:

- Overview: [`packages/README.md`](../README.md)
- Architecture and interactions: [`packages/ARCHITECTURE.md`](../ARCHITECTURE.md)

`@cline/llms` remains the canonical source for model/provider cataloging and provider settings schema.

## Runtime entrypoints

- Default package entrypoint: `@cline/llms`
- Node/runtime explicit entrypoint: `@cline/llms/node`

The default export map resolves to a browser-safe bundle under browser/react-server conditions, and to the Node runtime bundle under standard Node import conditions.
The package `development` export conditions also resolve to `dist/*` to avoid Turbopack source-resolution issues with `.js` specifiers in workspace TypeScript sources.
The build emits both `dist/index.js` (Node/default) and `dist/index.browser.js` (browser/react-server) to match this export map.

Vertex Claude routing in the Node runtime uses `@ai-sdk/google-vertex/anthropic`.

## Public API Boundaries

`@cline/llms` now exposes a curated `providers` namespace via:

- Node/default: `src/providers/public.ts`
- Browser: `src/providers/public.browser.ts`

Use `providers` for runtime handler creation + shared contracts:

- handler creation: `createHandler`, `createHandlerAsync`
- provider resolution: `resolveProviderConfig`, `OPENAI_COMPATIBLE_PROVIDERS`
- shared contracts/schemas: `ProviderConfig`, `ProviderSettings`, `ProviderSettingsSchema`, `Message`, `ApiStreamChunk`

Internal provider implementation modules (`handlers/*`, `transform/*`, `utils/*`) remain internal and are not part of the top-level package contract.

## Catalog and Provider Defaults

OpenAI-compatible provider discovery is centralized in `src/providers/shared/openai-compatible.ts` and reused by:

- `src/providers/handlers/providers.ts` (runtime defaults + live/private model merge)
- `src/catalog.ts` (catalog view with known models)
- `scripts/models/generate-models-dev.ts` and live-catalog loading via shared models.dev key maps from `@cline/shared`

This keeps provider default derivation and protocol filtering in one place.

Provider model-catalog key remapping is centralized in `@cline/shared` (`src/llms/model-id.ts`, `MODELS_DEV_PROVIDER_KEY_ENTRIES`) and reused by:

- `src/providers/types/settings.ts` (`toProviderConfig`) for generated known-model hydration
- `src/providers/handlers/providers.ts` (`mergeKnownModels`) for runtime generated/live/private model merging

Generated models imported from models.dev now exclude entries marked with `status: "deprecated"` at normalization time, so `src/models/generated.ts` only contains non-deprecated tool-capable entries.

## Provider Runtime Notes

- Provider IDs and alias normalization (for example, `openai` -> `openai-native`) are centralized in `src/providers/types/provider-ids.ts` and reused across provider auth, handler factory routing, and app call sites.
- Built-in handler routing is table-driven in `src/providers/index.ts` (`BUILT_IN_HANDLER_FACTORIES`) and shared by both `createHandler` and `createHandlerAsync` (async only adds catalog-refresh resolution before falling back to the same sync routing path).
- The model registry lazy-loader (`src/models/registry.ts`) includes `openai-native` (plus `openai` alias), `openrouter`, `zai`, `doubao`, `moonshot`, `qwen`, `qwen-code`, `sapaicore`, and `minimax` as built-in provider loaders.
- Registry loader registration is consolidated through one `BUILT_IN_PROVIDER_LOADER_ENTRIES` table in `src/models/registry.ts` to reduce duplicated `PROVIDER_LOADERS.set(...)` boilerplate.
- Built-in provider ID drift is guarded by `src/providers/types/provider-ids.test.ts`, which checks `BUILT_IN_PROVIDER_IDS` against `getProviderIds()` from the model registry.
- Fetch-based providers can share `FetchBaseHandler` (`src/providers/handlers/fetch-base.ts`) for common JSON request plumbing, error handling, and retry behavior; `AskSageHandler` is implemented on top of this base.
- `openai-codex`, `claude-code`, `opencode`, `mistral`, `dify`, `sapaicore`, and Vertex Claude routes share a common AI SDK runtime bridge (`handlers/ai-sdk-community.ts`) for message mapping and stream normalization.
- `openai-codex`, `claude-code`, `opencode`, `mistral`, `dify`, and `sapaicore` are consolidated in `handlers/community-sdk.ts` and share a common SDK-backed handler base (`handlers/ai-sdk-provider-base.ts`) for provider loading, model resolution, and stream wiring.
- Tests for Claude Code, OpenCode, Mistral, Dify, and SAP AI Core community handlers are consolidated in `handlers/community-sdk.test.ts`.
- `providerId: "openai-codex"` uses `ai-sdk-provider-codex-cli` (Codex CLI), not OpenCode.
- Codex CLI executes its own tools; AI SDK custom tool schemas are ignored for this provider path.
- OAuth-backed `openai-codex` settings do not force `OPENAI_API_KEY`; only explicit OpenAI API keys (`sk-...`) map to Codex CLI env.
- `openai-codex` retains a catalog `baseUrl` only for provider-registry inclusion; runtime requests are handled by `CodexHandler`.
- In Bun + Zod v3 workspaces, `CodexHandler` applies a runtime compatibility shim for `ai-sdk-provider-codex-cli` schema loading.
- `providerId: "opencode"` uses the OpenCode provider (`ai-sdk-provider-opencode-sdk`).
- `opencode` ignores AI SDK custom tool schemas; tools are executed provider-side.
- `providerId: "claude-code"` uses `ai-sdk-provider-claude-code`, defaults to `sonnet`, and supports `sonnet`, `opus`, `haiku`.
- `providerId: "sapaicore"` uses `@jerome-benoit/sap-ai-provider`; auth is handled by SAP AI SDK environment credentials (`AICORE_SERVICE_KEY` or `VCAP_SERVICES`).
- Set `AI_SDK_LOG_WARNINGS=false` to suppress AI SDK warning logs.
- Provider settings `headers` must be a string-to-string map (`Record<string, string>`).
- Provider settings OAuth auth schema includes `auth.expiresAt` (epoch ms) for runtime token refresh orchestration in `@cline/core`.
- `toProviderConfig(...)` now backfills `knownModels` from generated model catalogs for non-OpenAI-compatible providers (and alias routes like `openai-native` -> `openai`, `claude-code` -> `anthropic`, `cline` -> `vercel-ai-gateway`) so pricing metadata is available for usage cost calculation.
- Stream chunks are modeled as discriminated unions (`ApiStreamChunk`); tests should narrow by `type` instead of casting to generic records.
- OpenAI-compatible tool schemas default to strict mode; `openrouter` requests disable tool strictness for broader routed-model compatibility.
- OpenAI message conversion now normalizes malformed historical `tool_use.input` payloads (for example, top-level arrays) into object-shaped function arguments before replay.
- Anthropic message conversion now normalizes malformed historical `tool_use.input` payloads (for example, top-level arrays) into object-shaped arguments before replaying them to Anthropic/Bedrock APIs.
- Provider transform converters now coerce internal `file` content blocks into provider-native text payloads for both user messages and `tool_result` replay content (OpenAI, Gemini, Anthropic, R1).
- AI SDK community-provider message conversion (`toAiSdkMessages`) now lives in `src/providers/transform/ai-sdk-community-format.ts` and applies the same `file` block coercion for user/tool-result replay payloads.
- Retry decorator utility (`withRetry`) uses stage-3 decorators (no legacy decorator mode).

## Legacy Provider Migration Status

Source of truth for the legacy list: `src/core/api/index.ts`.

| Provider | Old code | New package |
| --- | --- | --- |
| `aihubmix` | ✅ | ✅ |
| `anthropic` | ✅ | ✅ |
| `asksage` | ✅ | ✅ |
| `baseten` | ✅ | ✅ |
| `bedrock` | ✅ | ✅ |
| `cerebras` | ✅ | ✅ |
| `claude-code` | ✅ | ✅ |
| `cline` | ✅ | ✅ |
| `deepseek` | ✅ | ✅ |
| `dify` | ✅ | ✅ |
| `doubao` | ✅ | ✅ |
| `fireworks` | ✅ | ✅ |
| `gemini` | ✅ | ✅ |
| `groq` | ✅ | ✅ |
| `hicap` | ✅ | ✅ |
| `huawei-cloud-maas` | ✅ | ✅ |
| `huggingface` | ✅ | ✅ |
| `litellm` | ✅ | ✅ |
| `lmstudio` | ✅ | ✅ |
| `minimax` | ✅ | ✅ |
| `mistral` | ✅ | ✅ |
| `moonshot` | ✅ | ✅ |
| `nebius` | ✅ | ✅ |
| `nousResearch` | ✅ | ✅ |
| `oca` | ✅ | ✅ |
| `ollama` | ✅ | ✅ |
| `openai` | ✅ | ✅ |
| `openai-codex` | ✅ | ✅ |
| `openai-native` | ✅ | ✅ |
| `opencode` | ❌ | ✅ |
| `openrouter` | ✅ | ✅ |
| `qwen` | ✅ | ✅ |
| `qwen-code` | ✅ | ✅ |
| `requesty` | ✅ | ✅ |
| `sambanova` | ✅ | ✅ |
| `sapaicore` | ✅ | ✅ |
| `together` | ✅ | ✅ |
| `vercel-ai-gateway` | ✅ | ✅ |
| `vertex` | ✅ | ✅ |
| `vscode-lm` | ✅ | ❌ |
| `xai` | ✅ | ✅ |
| `zai` | ✅ | ✅ |

`vscode-lm` is client-hosted (VS Code LM/Copilot runtime), so it is not a built-in package provider. VS Code clients can add it via `registerHandler()` or `registerAsyncHandler()`.

`New package` is marked `✅` only when the provider has a built-in handler route in `src/providers/index.ts` (explicit or OpenAI-compatible defaults), not just an enum entry.

### Support Snapshot (Docs Sync)

- Legacy provider rows tracked: `42`
- Built-in in `@cline/llms`: `41`
- Not built-in in `@cline/llms`: `1` (`vscode-lm`)
- Newly built-in vs legacy: `opencode`, `dify`, `mistral`, `asksage`

## Live Provider Smoke Test

A live smoke test is available at `src/live-providers.test.ts`. It reads provider
configurations from a JSON file, sends a simple prompt to each configured provider,
and reports which providers returned errors.

The test is opt-in and only runs when:

- `LLMS_LIVE_TESTS=1`
- `LLMS_LIVE_PROVIDERS_PATH=/absolute/path/to/providers.json`

Optional:

- `LLMS_LIVE_PROVIDER_TIMEOUT_MS=90000` (per-provider timeout; default `90000`)

Run:

```bash
cd sdk-wip/packages/llms
LLMS_LIVE_TESTS=1 LLMS_LIVE_PROVIDERS_PATH=/abs/path/providers.json bun test src/live-providers.test.ts
```

Supported JSON formats:

1. Stored providers.json style:

```json
{
  "version": 1,
  "providers": {
    "anthropic": {
      "settings": {
        "provider": "anthropic",
        "apiKey": "sk-...",
        "model": "claude-sonnet-4-20250514"
      }
    }
  }
}
```

2. Direct array of `ProviderSettings` entries:

```json
[
  {
    "provider": "openrouter",
    "apiKey": "sk-...",
    "model": "anthropic/claude-sonnet-4"
  }
]
```
