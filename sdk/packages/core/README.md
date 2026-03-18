# @clinebot/core

`@clinebot/core` is the stateful orchestration layer of the Cline SDK. It
connects the agent runtime, provider settings, storage, default tools, and
session lifecycle into a host-ready runtime.

## What You Get

- session lifecycle and orchestration primitives
- provider settings and account services
- default runtime tools and MCP integration
- storage-backed session and team state helpers
- host-facing Node helpers through `@clinebot/core/server`

## Installation

```bash
npm install @clinebot/core
```

## Entry Points

- `@clinebot/core`: core contracts, shared utilities, and RPC helper re-exports (`RpcSessionClient`, `getRpcServerHealth`, runtime bridge helpers)
- `@clinebot/core/server`: Node/server helpers for building hosts and runtimes

## Typical Usage

Most host apps should start with `@clinebot/core/server`.

```ts
import { createSessionHost } from "@clinebot/core/server";

const host = await createSessionHost({});

const result = await host.start({
	config: {
		providerId: "anthropic",
		modelId: "claude-sonnet-4-6",
		apiKey: process.env.ANTHROPIC_API_KEY ?? "",
		cwd: process.cwd(),
		enableTools: true,
		systemPrompt: "You are a concise assistant.",
	},
	prompt: "Summarize this project.",
	interactive: false,
});

console.log(result.result?.text);
await host.dispose();
```

## Main APIs

### Runtime and Sessions

Use `@clinebot/core/server` for host-facing runtime assembly:

- `createSessionHost(...)`
- `DefaultSessionManager`
- `DefaultRuntimeBuilder`

### Default Tools

`@clinebot/core` owns the built-in host tools and executors:

- `createBuiltinTools(...)`
- `createDefaultTools(...)`
- `createDefaultExecutors(...)`

### Storage and Settings

The package also exports storage and settings helpers such as:

- `ProviderSettingsManager`
- `SqliteTeamStore`
- SQLite RPC session backend helpers from `@clinebot/core/server`

## Related Packages

- `@clinebot/agents`: stateless agent loop and tool primitives
- `@clinebot/llms`: provider/model configuration and handlers
- `@clinebot/rpc`: remote session and runtime transport

## More Examples

- Repo examples: [apps/examples/cline-sdk](https://github.com/cline/cline/tree/main/apps/examples/cline-sdk)
- Workspace overview: [README.md](https://github.com/cline/cline/blob/main/README.md)
- API and architecture references: [DOC.md](https://github.com/cline/cline/blob/main/DOC.md), [ARCHITECTURE.md](https://github.com/cline/cline/blob/main/ARCHITECTURE.md)
