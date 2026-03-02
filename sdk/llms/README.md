# @cline/llms

Config-driven SDK for selecting, validating, and extending the providers/models your app can use.

This package is the main LLM entrypoint in the monorepo:
- `@cline/llms`: SDK orchestration + config
- `@cline/llms/providers`: handler APIs and provider runtime config
- `@cline/llms/models`: model catalog and registry APIs

## Installation

```bash
bun add @cline/llms
```

## Quick Start (5 minutes)

### 1) Define a config

You can load JSON (`loadLlmsConfigFromFile`) or define config in TypeScript (`defineLlmsConfig`).

```ts
import { defineLlmsConfig } from "@cline/llms"

export const llmsConfig = defineLlmsConfig({
  providers: [
    {
      id: "cline",
      models: ["anthropic/claude-sonnet-4.5"],
      defaultModel: "anthropic/claude-sonnet-4.5",
      apiKeyEnv: "CLINE_API_KEY",
    },
    {
      id: "anthropic",
      models: ["claude-sonnet-4-20250514"],
      apiKeyEnv: "ANTHROPIC_API_KEY",
    },
  ],
})
```

### 2) Create the SDK and a handler

```ts
import { createLlmsSdk } from "@cline/llms"
import { llmsConfig } from "./llms.config"

const llms = createLlmsSdk(llmsConfig)

const handler = llms.createHandler({
  providerId: "cline", // modelId omitted -> provider defaultModel
})

const anthropicHandler = llms.createHandler({
  providerId: "anthropic",
  modelId: "claude-sonnet-4-20250514",
})
```

## Config Reference

Each entry in `providers` (`ProviderSelectionConfig`) supports:
- `id`: provider id (built-in or custom)
- `models`: allowlisted model ids for this SDK instance
- `defaultModel`: optional; falls back to first item in `models`
- `apiKey` or `apiKeyEnv`: auth
- `baseUrl`, `headers`, `timeoutMs`: endpoint overrides
- `capabilities`: provider capability flags (for handler behavior)
- `settings`: advanced `ProviderConfig` defaults merged into each `createHandler(...)` call

## Vertex AI (Google Cloud) Usage

`@cline/llms` supports Vertex AI through the Gemini handler.

- For `createLlmsSdk(...)`, use provider id `vertex` and set `settings.gcp.projectId`.
- For low-level `providers.createHandler(...)`, use `providerId: "vertex"`.

### SDK config (`createLlmsSdk`) with Vertex

```ts
import { createLlmsSdk, defineLlmsConfig } from "@cline/llms"

const llms = createLlmsSdk(
  defineLlmsConfig({
    providers: [
      {
        id: "vertex",
        models: ["gemini-3-flash", "claude-sonnet-4@20250514"],
        defaultModel: "gemini-3-flash",
        settings: {
          gcp: { projectId: process.env.GCP_PROJECT_ID! },
          region: "us-central1",
        },
      },
    ],
  })
)

const handler = llms.createHandler({ providerId: "vertex" })
```

### Low-level provider API with `providerId: "vertex"`

```ts
import { providers } from "@cline/llms"

const handler = providers.createHandler({
  providerId: "vertex",
  modelId: "gemini-3-flash",
  gcp: { projectId: process.env.GCP_PROJECT_ID! },
  region: "us-central1",
})
```

When `gcp.projectId` is set, the Gemini handler uses Vertex AI auth flow (ADC/service account) rather than API key auth.

## Custom Headers

You can attach custom headers globally in provider config, or per call via `overrides`.

### Global headers in SDK config

```ts
const llms = createLlmsSdk({
  providers: [
    {
      id: "openai",
      models: ["gpt-5-mini"],
      apiKeyEnv: "OPENAI_API_KEY",
      headers: {
        "X-Request-Source": "my-app",
        "X-Tenant-Id": "tenant-123",
      },
    },
  ],
})
```

### Per-handler headers via overrides

```ts
const handler = llms.createHandler({
  providerId: "openai",
  overrides: {
    headers: {
      "X-Trace-Id": "trace-abc-123",
    },
  },
})
```

## Custom Model Lists and Metadata

There are 3 common patterns.

### A) Allowlist only specific models

This is the simplest option: only models listed here are permitted.

```ts
const llms = createLlmsSdk({
  providers: [
    {
      id: "openai",
      models: ["gpt-5-mini", "gpt-5"],
      defaultModel: "gpt-5-mini",
      apiKeyEnv: "OPENAI_API_KEY",
    },
  ],
})
```

### B) Provide your own known model metadata (`settings.knownModels`)

Use this when you want custom model labels/capabilities/token limits.

```ts
const llms = createLlmsSdk({
  providers: [
    {
      id: "openai",
      models: ["gpt-5-mini", "my-openai-proxy-model"],
      defaultModel: "my-openai-proxy-model",
      apiKeyEnv: "OPENAI_API_KEY",
      settings: {
        knownModels: {
          "my-openai-proxy-model": {
            name: "My OpenAI Proxy Model",
            contextWindow: 128000,
            maxTokens: 8192,
            capabilities: ["streaming", "tools", "reasoning"],
            status: "active",
          },
        },
      },
    },
  ],
})
```

### C) Enable runtime model catalog refresh (`settings.modelCatalog`)

For OpenAI-compatible providers, you can fetch newer catalog metadata at handler init time.

```ts
const llms = createLlmsSdk({
  providers: [
    {
      id: "openai",
      models: ["gpt-5-mini"],
      apiKeyEnv: "OPENAI_API_KEY",
      settings: {
        modelCatalog: {
          loadLatestOnInit: true,
          // optional:
          // url: "https://models.dev/api.json",
          // cacheTtlMs: 600_000,
          // failOnError: false,
        },
      },
    },
  ],
})

// Important: when loadLatestOnInit=true, use async handler creation.
const handler = await llms.createHandlerAsync({ providerId: "openai" })
```

## Add a New Provider to the Registry

You can register providers at startup (`customProviders`) or runtime (`llms.registerProvider`).

### Option 1: Register at startup with `customProviders`

```ts
import { createLlmsSdk } from "@cline/llms"

const llms = createLlmsSdk({
  providers: [
    {
      id: "internal-openai-proxy",
      models: ["proxy-v1"],
      defaultModel: "proxy-v1",
      apiKeyEnv: "INTERNAL_PROXY_KEY",
    },
  ],
  customProviders: [
    {
      collection: {
        provider: {
          id: "internal-openai-proxy",
          name: "Internal OpenAI Proxy",
          defaultModelId: "proxy-v1",
          baseUrl: "https://llm-proxy.company.com/v1",
        },
        models: {
          "proxy-v1": {
            name: "Proxy v1",
            contextWindow: 128000,
            maxTokens: 8192,
            capabilities: ["streaming", "tools"],
            status: "active",
          },
          "proxy-v2": {
            name: "Proxy v2",
            contextWindow: 256000,
            maxTokens: 16384,
            capabilities: ["streaming", "tools", "reasoning"],
            status: "preview",
          },
        },
      },
      defaults: {
        baseUrl: "https://llm-proxy.company.com/v1",
      },
    },
  ],
})
```

### Option 2: Register at runtime with `llms.registerProvider(...)`

Use `exposeModels` to limit which registered models are usable in this SDK instance.

```ts
llms.registerProvider({
  collection: {
    provider: {
      id: "internal",
      name: "Internal AI",
      defaultModelId: "internal-v1",
    },
    models: {
      "internal-v1": {
        name: "Internal V1",
        contextWindow: 64000,
        maxTokens: 4096,
        capabilities: ["streaming", "tools"],
        status: "active",
      },
      "internal-v2": {
        name: "Internal V2",
        contextWindow: 128000,
        maxTokens: 8192,
        capabilities: ["streaming", "tools", "reasoning"],
        status: "preview",
      },
    },
  },
  exposeModels: ["internal-v2"],
  defaultModel: "internal-v2",
  defaults: {
    baseUrl: "https://internal.example.com/v1",
    apiKey: process.env.INTERNAL_API_KEY,
  },
})
```

### Option 3: Attach custom handler factories (non OpenAI-compatible protocol)

If your provider needs custom request/stream logic, register a handler factory:

```ts
import { createLlmsSdk, providers } from "@cline/llms"

const llms = createLlmsSdk({
  providers: [{ id: "openai", models: ["gpt-5-mini"], apiKeyEnv: "OPENAI_API_KEY" }],
})

llms.registerProvider({
  collection: {
    provider: {
      id: "my-protocol",
      name: "My Protocol",
      defaultModelId: "my-model",
    },
    models: {
      "my-model": { name: "My Model", status: "active" },
    },
  },
  handlerFactory: (config) => new providers.OpenAIBaseHandler(config), // replace with your own handler
})
```

## Add a New Model Without Adding a New Provider

```ts
llms.registerModel({
  providerId: "openai",
  modelId: "my-company-model",
  info: {
    name: "My Company Model",
    contextWindow: 128000,
    maxTokens: 8192,
    capabilities: ["streaming", "tools"],
    status: "active",
  },
})
```

## API Surface

- `createLlmsSdk(config)`
- `loadLlmsConfigFromFile(path)`
- `defineLlmsConfig(config)`
- `llms.createHandler(input)` / `llms.createHandlerAsync(input)`
- `llms.registerProvider(input)`
- `llms.registerModel(input)`
- `llms.getProviders()`
- `llms.getModels(providerId)`
- `llms.isProviderConfigured(providerId)`
- `llms.isModelConfigured(providerId, modelId)`
