# @cline/core

Stateful orchestration primitives shared by CLI and desktop runtimes.

`@cline/core` is where app-level state and orchestration live. It builds on `@cline/agents` primitives and adds:

- `auth`: provider/environment credential resolution
- `runtime`: runtime composition and bootstrap wiring
- `session`: root/sub-agent session lifecycle and status transitions
- `storage`: durable session persistence (`SqliteSessionStore`)
- `types`: shared contracts for session manager/store/runtime builders

## Install

```bash
npm install @cline/core
```

## What Belongs Here

Use `@cline/core` for:

- Persistent session tracking across process boundaries
- Orchestration that spans multiple agent runs
- Runtime assembly that combines tools, teams, and storage

Keep `@cline/agents` for:

- The `Agent` execution loop
- Tool/hook/team runtime primitives

## Key Exports

- `resolveCredentials`, `DefaultCredentialsResolver`
- `DefaultRuntimeBuilder`, `createTeamName`
- `CoreSessionService`
- `SqliteSessionStore`
- `deriveSubsessionStatus`, `makeSubSessionId`, `makeTeamTaskSubSessionId`, `sanitizeSessionToken`

## Runtime + Session Composition Example

```ts
import { createSpawnAgentTool } from "@cline/agents"
import {
	CoreSessionService,
	DefaultRuntimeBuilder,
	SqliteSessionStore,
	resolveCredentials,
	type CoreSessionConfig,
} from "@cline/core"

const credentials = resolveCredentials({
	providerId: "anthropic",
	explicitApiKey: process.env.ANTHROPIC_API_KEY,
})

const config: CoreSessionConfig = {
	providerId: credentials.providerId,
	apiKey: credentials.apiKey,
	modelId: "claude-sonnet-4-5-20250929",
	systemPrompt: "You are a helpful coding assistant.",
	cwd: process.cwd(),
	enableTools: true,
	enableSpawnAgent: true,
	enableAgentTeams: true,
}

const runtimeBuilder = new DefaultRuntimeBuilder()
const runtime = runtimeBuilder.build({
	config,
	createSpawnTool: () =>
		createSpawnAgentTool({
			providerId: config.providerId,
			modelId: config.modelId,
			apiKey: config.apiKey ?? "",
		}),
})

const store = new SqliteSessionStore({ sessionsDir: process.env.CLINE_SESSION_DATA_DIR })
const sessions = new CoreSessionService(store)

// Host app can now create/update root/sub-agent sessions around runtime usage.
```
