export const overviewStats = [
	{ value: "1", label: "Monolith" },
	{ value: "5+1", label: "SDK Packages + Shared" },
	{ value: "3,500", label: "Lines → ~1,400" },
	{ value: "25", label: "Tools → 7" },
	{ value: "45+", label: "Handlers → SDK-first" },
];

export const keyShifts = [
	{
		title: 'From "God Class" to Composition',
		description:
			"The original Task class owns everything: API calls, streaming, tool parsing, tool execution, approval flows, context building, message persistence, checkpoint management, and UI updates. The new Agent class delegates to MessageBuilder, ToolRegistry, ContributionRegistry, HookEngine, and the @clinebot/llms handler.",
	},
	{
		title: "From VS Code-Coupled to Platform-Agnostic",
		description:
			"Original Cline is deeply coupled to VS Code APIs. The new SDK has zero VS Code dependency in llms, agents, or core. Platform specifics now live in real host runtimes (CLI session manager, Code/Desktop runtime bridge scripts + Tauri command layer).",
	},
	{
		title: "From XML Parsing to Native Tool Calls",
		description:
			"Original Cline parses tool calls from XML tags in the assistant's text response. SDK-WIP uses the model's native tool_use blocks with JSON schemas, falling back to structured output only when needed.",
	},
	{
		title: "From Flat Config to Typed Contracts",
		description:
			"Original: one ApiConfiguration interface with 100+ flat fields covering all providers. New: per-provider Zod-validated ProviderSettings with a discriminated union on provider field.",
	},
];

export const packages = [
	{
		name: "@clinebot/llms",
		description:
			"Provider catalog, model metadata, handler creation. Auto-generated model catalog. Zod schemas per provider. SDK-first handler bases (Anthropic, OpenAI-compatible, Bedrock, Gemini, Vertex, R1, community SDK). Zero dependency on other internal packages.",
	},
	{
		name: "@clinebot/agents",
		description:
			"~1,400-line Agent loop, ToolRegistry, ContributionRegistry, HookEngine, subprocess hooks, AgentTeam + AgentTeamsRuntime, system prompt templates. Browser-safe — no Node-specific tools.",
	},
	{
		name: "@clinebot/rpc",
		description:
			"gRPC routing server for clients, sessions, tasks, and tool approvals. Event streaming and runtime chat bridge helpers for app hosts.",
	},
	{
		name: "@clinebot/core",
		description:
			"RuntimeBuilder, SessionRuntime contract, SessionService lifecycle orchestrator, SQLite SessionStore, ArtifactStore, SessionGraph, 7 builtin tools (read_files, search_codebase, run_commands, fetch_web_content, editor, skills, ask_question), plus host-facing session manager and runtime host factory APIs.",
	},
	{
		name: "@clinebot/shared",
		description:
			"Shared contracts, schemas, types, and utilities used across SDK packages. Includes tool contract types, JSON stream parsing, and database helpers.",
	},
	{
		name: "@clinebot/cli",
		description:
			"Thin wrapper: parses args → builds runtime via core → runs agent. Session management (create, resume, list). Optional gRPC gateway via @clinebot/rpc.",
	},
	{
		name: "@clinebot/code",
		description:
			"Tauri (Rust) + Next.js desktop app. Chat UI with provider/model selection, settings, MCP server config, and rules discovery. Uses persistent runtime bridge scripts and RPC-backed chat event flow.",
	},
	{
		name: "@clinebot/desktop",
		description:
			"Tauri (Rust) + Next.js desktop app. Kanban board for agent teams + chat view. Uses persistent runtime bridge scripts and RPC-backed chat event flow.",
	},
];

export const comparisonTable = [
	{
		dimension: "Shape",
		original: "Monolithic VS Code extension",
		new: "Bun workspace, 5 SDK packages + shared",
	},
	{
		dimension: "Agent loop",
		original: "Single Task class (~3,500 lines)",
		new: "Agent class (~1,400 lines) + composable delegates",
	},
	{
		dimension: "Tool system",
		original: "XML-parsed string params, hardcoded enum",
		new: "Zod-schema typed tools, registry pattern, JSON tool_use",
	},
	{
		dimension: "Provider/Model",
		original: "Giant switch factory, flat config 100+ fields",
		new: "@clinebot/llms catalog, SDK-first handler bases (Anthropic, OpenAI-compat, Bedrock, Gemini, Vertex, R1, community)",
	},
	{
		dimension: "Multi-agent",
		original: "Bolted-on subagent spawning (max 5 parallel)",
		new: "First-class AgentTeam + AgentTeamsRuntime with lead/worker",
	},
	{
		dimension: "Session/Storage",
		original: "VS Code globalState + filesystem JSON",
		new: "SQLite + manifest files, hierarchical session graph",
	},
	{
		dimension: "UI coupling",
		original: "Deeply interleaved with VS Code webview",
		new: "Decoupled: core runtime <- host runtime wiring -> UI (CLI / Code / Desktop / future)",
	},
	{
		dimension: "Extensibility",
		original: "MCP servers, custom instructions",
		new: "Extensions runtime + hooks (subprocess) + MCP",
	},
	{
		dimension: "Build",
		original: "esbuild single bundle",
		new: "Bun workspaces, per-package builds",
	},
];

export const deepDiveSections = [
	{
		num: "01",
		id: "packages",
		title: "Package Map & Dependency Graph",
		subtitle:
			"Monolith decomposed into 5 SDK packages (+ shared) with enforced boundaries",
	},
	{
		num: "02",
		id: "agent-loop",
		title: "The Agentic Loop",
		subtitle: "The most important document — the heart of both systems",
	},
	{
		num: "03",
		id: "tool-system",
		title: "Tool System",
		subtitle:
			"Definition, parsing, execution, and approval — where the biggest mechanical differences live",
	},
	{
		num: "04",
		id: "providers",
		title: "Provider & Model Management",
		subtitle:
			"From a giant switch factory to SDK-first wrappers with auto-generated catalogs",
	},
	{
		num: "05",
		id: "storage",
		title: "Session & Storage",
		subtitle: "From VS Code globalState to a database-backed session service",
	},
	{
		num: "06",
		id: "multi-agent",
		title: "Multi-Agent",
		subtitle:
			"From bolted-on subagents to first-class teams with persistent orchestration",
	},
	{
		num: "07",
		id: "runtime-hosts",
		title: "Runtime Host Integration",
		subtitle: "How CLI, Code, and Desktop actually wire core runtime today",
	},
	{
		num: "08",
		id: "decisions",
		title: "Key Architectural Decisions & Tradeoffs",
		subtitle: "10 consequential decisions and what they imply",
	},
];

export const toolConsolidation = [
	{ original: "read_file", new: "read_files (batched)" },
	{
		original: "search_files, list_files, list_code_definition_names",
		new: "search_codebase",
	},
	{ original: "execute_command", new: "run_commands (batched)" },
	{ original: "write_to_file, replace_in_file, apply_patch", new: "editor" },
	{ original: "browser_action", new: "fetch_web_content" },
	{ original: "N/A (new)", new: "skills (slash-command dispatch)" },
	{
		original: "ask_followup_question",
		new: "ask_question (clarifying question with selectable options)",
	},
	{
		original: "attempt_completion",
		new: "Built into agent loop (stop condition)",
	},
	{ original: "use_mcp_tool, access_mcp_resource", new: "Via extensions" },
	{ original: "use_subagents", new: "Via teams system" },
];

export const keyDecisions = [
	{
		num: "Decision 1",
		title: "Decompose the Monolith into SDK Packages",
		description:
			"The foundational decision. Every other decision follows from it. 5 SDK packages (llms, agents, rpc, core, shared) plus app targets. Enables agent loop as a library, not an application. Cost: build complexity, version coordination.",
	},
	{
		num: "Decision 2",
		title: "Native Tool Calls Instead of XML Parsing",
		description:
			"Eliminates custom streaming XML parser. Enables typed inputs and parallel execution. Risk: quality of tool calling may differ. Bet: native tool calling is industry direction.",
	},
	{
		num: "Decision 3",
		title: "Sequential Stream→Execute",
		description:
			"Dramatically simplifies the loop — no locks, no queues, no concurrent state mutation. Enables parallel tool execution. Cost: slightly higher perceived latency.",
	},
	{
		num: "Decision 4",
		title: "Hooks + Policies Instead of Hardcoded Approval",
		description:
			"Composable approval flow across CLI, desktop, API, CI. Policies are declarative. Cost: original's approval UI is highly polished; recreating this richness requires host-level UX work.",
	},
	{
		num: "Decision 5",
		title: "7 Consolidated Tools Instead of 25",
		description:
			"Fewer tools = simpler model choices, fewer round trips, extensible via registry. 7 builtins: read_files, search_codebase, run_commands, fetch_web_content, editor, skills, ask_question. Risk: does tool consolidation improve or degrade agent performance? Needs empirical testing.",
	},
	{
		num: "Decision 6",
		title: "SDK-First Provider Integration",
		description:
			"~7 handler bases instead of 45+ custom handlers. Official SDKs (Anthropic, OpenAI-compat, Bedrock, Gemini, Vertex, R1, community) handle auth, retries, streaming. Auto-generated model catalog. Cost: less fine-grained control over provider-specific features.",
	},
	{
		num: "Decision 7",
		title: "SQLite Instead of VS Code GlobalState",
		description:
			"Platform independent. Structured queries. Hierarchical session IDs. Better concurrency. Cost: native dependency, migration management, more complex than JSON files for simple cases.",
	},
	{
		num: "Decision 8",
		title: "Teams as First-Class Primitives",
		description:
			"Multi-agent is a core product direction (desktop kanban board). Lead/worker topology enables sophisticated orchestration. Cost: significant complexity, deadlocks/loops/cost runaway risks.",
	},
];

// Agent Loop Section
export const agentLoopComparison = [
	{
		aspect: "Lines of code",
		original: "~3,500 (+ modules)",
		new: "~1,400 (+ delegates)",
	},
	{ aspect: "Loop nesting", original: "3 levels", new: "Single while loop" },
	{
		aspect: "Tool format",
		original: "XML tags in text stream",
		new: "Native JSON tool_use blocks",
	},
	{
		aspect: "Stream + Execute",
		original: "Interleaved (tools execute during streaming)",
		new: "Sequential (stream completes, then execute)",
	},
	{
		aspect: "Concurrency control",
		original: "Lock flags, pending-update queues",
		new: "None needed (sequential)",
	},
	{
		aspect: "State management",
		original: "~40+ mutable flags in TaskState",
		new: "~15 instance fields (config, handler, registries, IDs, loop state)",
	},
	{
		aspect: "Approval",
		original: "Hardcoded ask/say webview pattern",
		new: "onToolCall hook + toolPolicies",
	},
	{
		aspect: "UI coupling",
		original: "Deep (vscode, webview, diff, terminal)",
		new: "None (event-driven)",
	},
	{
		aspect: "Testability",
		original: "Requires mocking VS Code APIs",
		new: "Pure function testing with mock hooks",
	},
];

// Provider & Model Management Section
export const providerComparison = [
	{
		aspect: "Config shape",
		original: "One flat interface, 100+ fields",
		new: "Discriminated union, per-provider schemas",
	},
	{
		aspect: "Validation",
		original: "None (trust-based)",
		new: "Zod schemas, compile-time + runtime",
	},
	{
		aspect: "Provider count",
		original: "~45 handler files",
		new: "~7 SDK-first handler bases (Anthropic, OpenAI-compat, Bedrock, Gemini, Vertex, R1, community)",
	},
	{
		aspect: "Model catalog",
		original: "Hardcoded in source",
		new: "Auto-generated from upstream, script-driven",
	},
	{
		aspect: "Model metadata",
		original: "Flat ModelInfo with boolean flags",
		new: "Structured ModelMetadata with nested capabilities/pricing",
	},
	{
		aspect: "Settings storage",
		original: "VS Code globalState",
		new: "JSON file, Zod-validated, per-provider sections",
	},
	{
		aspect: "Adding a provider",
		original: "New file + switch case + config fields",
		new: "Implement handler or configure OpenAI-compatible endpoint",
	},
];

// Session & Storage Section
export const sessionComparison = [
	{
		aspect: "Primary store",
		original: "VS Code globalState",
		new: "SQLite (WAL mode)",
	},
	{
		aspect: "Message storage",
		original: "JSON files per task",
		new: "ArtifactStore (append-only files)",
	},
	{
		aspect: "Session metadata",
		original: "Flat history array in globalState",
		new: "Structured SQLite records",
	},
	{
		aspect: "Parent-child",
		original: "Subagent tracking via flags",
		new: "Hierarchical SessionGraph IDs",
	},
	{
		aspect: "Checkpoints",
		original: "Git-based snapshot + revert",
		new: "Not yet implemented",
	},
	{
		aspect: "Context management",
		original: "Truncation + LLM compaction",
		new: "Simpler (TBD growth)",
	},
	{
		aspect: "Message model",
		original: "Dual streams (API + UI messages)",
		new: "Single message stream",
	},
	{
		aspect: "Platform coupling",
		original: "VS Code globalState API",
		new: "Plain files + SQLite",
	},
];

// Multi-Agent Section
export const multiAgentComparison = [
	{ aspect: "Max agents", original: "5 hardcoded", new: "Unlimited" },
	{
		aspect: "Topologies",
		original: "Fan-out only",
		new: "Route, parallel, sequential, pipeline, lead/worker",
	},
	{
		aspect: "Communication",
		original: "None between children",
		new: "Lead can delegate, broadcast, query status",
	},
	{
		aspect: "Nesting",
		original: "Single level",
		new: "Agents can spawn agents (recursive)",
	},
	{
		aspect: "Persistence",
		original: "Ephemeral",
		new: "TeamStore with state + history",
	},
	{ aspect: "Dynamic creation", original: "No", new: "spawnAgentTool" },
	{
		aspect: "Event tracking",
		original: "UI messages",
		new: "Structured TeamEvent stream",
	},
	{
		aspect: "Orchestration",
		original: "Parent tool handles everything",
		new: "Lead agent uses routing tools autonomously",
	},
];

// Runtime Host Integration Section
export const adapterCapabilities = [
	{
		name: "CLI App",
		subtitle: "stdin/stdout + session manager",
		description:
			"Uses createDefaultCliSessionManager(...) to compose runtime and session backend (RPC first, local fallback). Streams events to terminal and handles approvals via TTY/file IPC.",
	},
	{
		name: "Code App",
		subtitle: "Tauri + Next.js + chat-runtime-bridge",
		description:
			"Tauri ensures/registers RPC, starts local chat WebSocket endpoint, and runs a persistent scripts/chat-runtime-bridge.ts process backed by @clinebot/rpc runtime helpers.",
	},
	{
		name: "Desktop App",
		subtitle: "Tauri + Next.js + chat-runtime-bridge",
		description:
			"Same RPC-backed bridge pattern as Code app, with desktop-specific chat + team orchestration views and event fanout.",
	},
];

export const adapterEnables = [
	{
		title: "CLI, Code, and Desktop from same core",
		description:
			"All three apps compose the same SDK packages (llms, agents, core, rpc). No code duplication of agent logic.",
	},
	{
		title: "Testing without UI",
		description:
			"Run agent with mock hooks, assert on tool calls and results. No VS Code mocking required.",
	},
	{
		title: "gRPC Gateway (via @clinebot/rpc)",
		description:
			"Multi-client session routing, tool approval flows, and event streaming over gRPC. Available via clite rpc start.",
	},
	{
		title: "CI/CD agents",
		description:
			'Run agents headless with toolPolicies: { "*": "allow" } — no human in the loop.',
	},
];

export const missingFeatures = [
	{ feature: "Git-based checkpoints", status: "not-implemented" },
	{
		feature: "Context compaction (LLM summarization)",
		status: "not-implemented",
	},
	{ feature: "Inline diff preview (approval UX)", status: "adapter-dependent" },
	{ feature: "Browser automation (Puppeteer in-loop)", status: "simplified" },
	{ feature: "Shell integration (VS Code terminal)", status: "simplified" },
	{ feature: "Tree-sitter code analysis", status: "not-implemented" },
	{ feature: "MCP client hub", status: "adapter-dependent" },
	{ feature: "Plan/Act modes", status: "adapter-dependent" },
];

export const entrypointMatrix = [
	{
		pkg: "@clinebot/llms",
		browser: "Yes (`@clinebot/llms/browser` or conditionally `@clinebot/llms`)",
		node: "Yes (`@clinebot/llms/node` or `@clinebot/llms`)",
		notes:
			"Primary package to use for browser environments. Browser export uses browser-safe provider surface.",
	},
	{
		pkg: "@clinebot/agents",
		browser: "Export exists but throws at runtime",
		node: "Yes (`@clinebot/agents` or `@clinebot/agents/node`)",
		notes:
			"Agent loop is Node-only in current architecture. Do not run full Agent runtime in browser.",
	},
	{
		pkg: "@clinebot/rpc",
		browser: "Export exists but throws at runtime",
		node: "Yes (`@clinebot/rpc` or `@clinebot/rpc/node`)",
		notes:
			"RPC client/server runtime is Node-only. Browser export is a guard surface.",
	},
	{
		pkg: "@clinebot/core",
		browser: "Browser export exists",
		node: "Yes (`@clinebot/core` or `@clinebot/core/node`)",
		notes:
			"Use for shared contracts/types and selected browser-safe surfaces. Stateful runtime/session backends remain Node-hosted.",
	},
	{
		pkg: "@clinebot/core/server",
		browser: "Not for browser runtime usage",
		node: "Yes (`@clinebot/core/server`)",
		notes:
			"Server/session runtime assembly and storage backends are Node-only concerns.",
	},
	{
		pkg: "@clinebot/shared",
		browser: "No dedicated browser subpath",
		node: "Yes (`@clinebot/shared`)",
		notes:
			"Shared contracts/utils package. Keep browser usage to browser-safe imports only.",
	},
] as const;

export const browserUsageGuidelines = [
	"For browser LLM access, import from `@clinebot/llms/browser` explicitly.",
	"Do not import `@clinebot/agents` runtime loop in browser clients.",
	"Do not import `@clinebot/rpc` runtime clients/servers in browser clients.",
	"Treat browser apps as UI/control planes; keep stateful runtime execution in Node hosts (CLI/Tauri/RPC server).",
	"Use RPC/WebSocket bridges to communicate with Node-hosted runtimes when browser UI needs agent results.",
];
