# @cline/agents

Runtime primitives for building agentic loops with LLMs.

`@cline/agents` is the runtime layer. It focuses on:

- `Agent` loop execution
- Tool definition, validation, and execution helpers
- Hook and extension interception points
- Team primitives for sub-agents and collaboration
- Streaming/event utilities for host apps

Stateful app orchestration now lives in `@cline/core` (session lifecycle, storage, runtime composition).

For broader API coverage, see `/Users/beatrix/dev/cline/packages/agents/DOC.md`.

## Install

```bash
npm install @cline/agents
```

## Quick Start

```ts
import { Agent, createTool } from "@cline/agents"

const echo = createTool({
	name: "echo",
	description: "Echo input text",
	inputSchema: {
		type: "object",
		properties: {
			text: { type: "string", description: "Text to echo" },
		},
		required: ["text"],
	},
	execute: async ({ text }: { text: string }) => ({ echoed: text }),
})

const agent = new Agent({
	providerId: "anthropic",
	modelId: "claude-sonnet-4-5-20250929",
	apiKey: process.env.ANTHROPIC_API_KEY,
	systemPrompt: "You are helpful and concise.",
	tools: [echo],
})

const result = await agent.run("Use the echo tool with text 'hello'.")
console.log(result.text)
```

## Package Boundary

Use `@cline/agents` for:

- Stateless runtime behavior inside an agent run
- Tool-calling loops and interception
- Team/task coordination primitives

Use `@cline/core` for:

- Persistent sessions and session graph state
- Session storage and transcript/message persistence
- Runtime assembly for full app/CLI environments

## Extensions and Hooks

`extensions` and `hooks` serve different runtime roles.

- Use `extensions` for modular policy/plugins and registration (`tools`, `commands`, `shortcuts`, `flags`, `providers`)
- Use `hooks` for lifecycle callbacks and subprocess bridges
- Use `createSubprocessHooks()` to emit Pi-style hook events (`tool_call`, `tool_result`, `agent_end`, `session_shutdown`)

## Tool Policy and Approval

`Agent` now supports per-tool execution policy and runtime approval requests:

- `toolPolicies`: map of tool name -> `{ enabled?: boolean; autoApprove?: boolean }`
- `requestToolApproval(request)`: callback used when `autoApprove` is `false`
- Global defaults can be set with `"*"` in `toolPolicies`

```ts
import { Agent } from "@cline/agents"

const agent = new Agent({
	providerId: "anthropic",
	modelId: "claude-sonnet-4-6",
	systemPrompt: "You are helpful and concise.",
	tools: [...],
	toolPolicies: {
		"*": { autoApprove: false }, // require approval by default
		read_files: { autoApprove: true }, // allow without prompt
		run_commands: { enabled: false }, // disable entirely
	},
	requestToolApproval: async ({ toolName, input }) => {
		// Host app decides if this tool call is allowed.
		return { approved: toolName !== "run_commands", reason: "Blocked by host policy" }
	},
})
```

If a tool is disabled or not approved, execution is skipped and the tool call is returned as an error record.

## Teams

Use team primitives when a lead agent must coordinate sub-agents:

- `AgentTeamsRuntime`
- `bootstrapAgentTeams(...)`
- `createSpawnAgentTool(...)`
- `createAgentTeamsTools(...)`

## Architecture

For runtime internals, see:

- `/Users/beatrix/dev/cline/packages/agents/ARCHITECTURE.md`
