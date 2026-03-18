export const packages = [
	"@clinebot/shared",
	"@clinebot/llms",
	"@clinebot/agents",
	"@clinebot/rpc",
	"@clinebot/core",
	"@clinebot/cli",
	"@clinebot/code",
	"@clinebot/desktop",
	"RPC Server",
] as const;

export type TransportType = "rpc" | "ws" | "local";

export interface Step {
	title: string;
	summary: string;
	transport: TransportType;
	packages: string[];
	methods: string[];
}

export interface Scenario {
	title: string;
	steps: Step[];
}

export const scenarios: Record<string, Scenario> = {
	promptFlow: {
		title: "Prompt Request Flow (CLI to Response)",
		steps: [
			{
				title: "User Submits Prompt",
				summary:
					"User submits prompt to clite; CLI builds session/runtime config and initializes session manager.",
				transport: "local",
				packages: ["@clinebot/cli", "@clinebot/core"],
				methods: [
					"createDefaultCliSessionManager()",
					"start()",
					"chat_session_command",
				],
			},
			{
				title: "RPC Health Check",
				summary:
					"CLI tries RPC first: resolves/ensures RPC address, checks health via gRPC health probe.",
				transport: "rpc",
				packages: ["@clinebot/cli", "@clinebot/rpc", "RPC Server"],
				methods: [
					"getRpcServerHealth()",
					"ensureRpcAddressViaCli()",
					"gRPC health check",
				],
			},
			{
				title: "RPC Server Startup (if needed)",
				summary:
					"If RPC unavailable, CLI starts RPC server in background, retries health checks until ready.",
				transport: "rpc",
				packages: ["@clinebot/cli", "@clinebot/rpc", "RPC Server"],
				methods: [
					"startRpcServerInBackground()",
					"retry health checks",
					"startRpcServer()",
				],
			},
			{
				title: "RPC Client Connection",
				summary:
					"CLI creates RpcSessionClient connected to the available RPC server address.",
				transport: "rpc",
				packages: ["@clinebot/cli", "@clinebot/rpc"],
				methods: ["new RpcSessionClient(address)", "registerRpcClient()"],
			},
			{
				title: "Start Runtime Session",
				summary:
					"CLI sends StartRuntimeSession request with typed RuntimeSessionConfig; server creates session with metadata.",
				transport: "rpc",
				packages: [
					"@clinebot/cli",
					"@clinebot/rpc",
					"@clinebot/core",
					"RPC Server",
				],
				methods: [
					"StartRuntimeSession(request)",
					"RpcSessionClient.startRuntimeSession()",
					"gRPC StartRuntimeSession",
				],
			},
			{
				title: "Session Created Response",
				summary:
					"RPC Server allocates sessionId, initializes runtime handlers, returns StartRuntimeSessionResponse.",
				transport: "rpc",
				packages: [
					"@clinebot/rpc",
					"@clinebot/core",
					"@clinebot/agents",
					"RPC Server",
				],
				methods: [
					"createRpcRuntimeHandlers()",
					"StartRuntimeSessionResponse",
					"sessionId",
				],
			},
			{
				title: "Stream Events Subscription",
				summary:
					"Before sending turn, CLI opens StreamEvents subscription for live text/tool event streaming.",
				transport: "rpc",
				packages: ["@clinebot/cli", "@clinebot/rpc", "RPC Server"],
				methods: [
					"StreamEvents({sessionIds:[sessionId]})",
					"gRPC StreamEvents subscribe",
					"runtime.chat.*",
				],
			},
			{
				title: "Send Prompt Turn",
				summary:
					"CLI sends actual prompt turn via SendRuntimeSession with typed RuntimeTurnRequest payload.",
				transport: "rpc",
				packages: ["@clinebot/cli", "@clinebot/rpc", "RPC Server"],
				methods: [
					"SendRuntimeSession(sessionId, request)",
					"gRPC SendRuntimeSession",
				],
			},
			{
				title: "Agent Loop Execution",
				summary:
					"Server-side runtime executes agent loop: model calls, tool executions, and reasoning.",
				transport: "rpc",
				packages: [
					"@clinebot/agents",
					"@clinebot/llms",
					"@clinebot/core",
					"RPC Server",
				],
				methods: ["execute agent turn", "model calls", "tool executions"],
			},
			{
				title: "Event Publishing Loop",
				summary:
					"During execution, runtime publishes events (text_delta, tool_call_*) that stream to CLI.",
				transport: "rpc",
				packages: ["@clinebot/rpc", "@clinebot/core", "RPC Server"],
				methods: [
					"PublishEvent()",
					"runtime.chat.text_delta",
					"runtime.chat.tool_call_*",
				],
			},
			{
				title: "Stream Events Received",
				summary:
					"CLI receives streamed RoutedEvents, processes onEvent callbacks, emits agent events to UI.",
				transport: "rpc",
				packages: ["@clinebot/cli", "@clinebot/rpc"],
				methods: ["onEvent(...)", "emitAgentEvent()", "content/tool updates"],
			},
			{
				title: "Turn Completion",
				summary:
					"Runtime completes turn, RPC returns typed RuntimeTurnResult in SendRuntimeSessionResponse.",
				transport: "rpc",
				packages: [
					"@clinebot/rpc",
					"@clinebot/core",
					"@clinebot/agents",
					"RPC Server",
				],
				methods: ["final turn result", "SendRuntimeSessionResponse(result)"],
			},
			{
				title: "Stream Cleanup",
				summary:
					"CLI stops StreamEvents subscription, merges any remaining streamed text with final result.",
				transport: "local",
				packages: ["@clinebot/cli", "@clinebot/rpc"],
				methods: [
					"stop StreamEvents subscription",
					"merge streamed text + final result",
				],
			},
			{
				title: "Response Output",
				summary:
					"CLI converts to final AgentResult, emits done event, and prints completed response to user.",
				transport: "local",
				packages: ["@clinebot/cli", "@clinebot/core"],
				methods: ["toAgentResult()", "emit done", "print completion output"],
			},
		],
	},
	session: {
		title: "Session Lifecycle",
		steps: [
			{
				title: "Session Intent Received",
				summary: "Host receives user prompt and selects runtime path.",
				transport: "local",
				packages: ["@clinebot/cli", "@clinebot/code", "@clinebot/core"],
				methods: [
					"createDefaultCliSessionManager",
					"chat_session_command(start/send)",
				],
			},
			{
				title: "RPC Availability Check",
				summary:
					"Ensure path verifies a compatible RPC server address and bootstraps if needed.",
				transport: "rpc",
				packages: ["@clinebot/cli", "@clinebot/rpc", "RPC Server"],
				methods: [
					"getRpcServerHealth",
					"clite rpc ensure/start",
					"startRpcServer",
				],
			},
			{
				title: "Session Initialized (In-Memory)",
				summary:
					"Runtime allocates session id + metadata in memory; root artifacts are not persisted yet.",
				transport: "rpc",
				packages: [
					"@clinebot/code",
					"@clinebot/cli",
					"@clinebot/rpc",
					"@clinebot/core",
					"RPC Server",
				],
				methods: [
					"StartRuntimeSession",
					"RpcSessionClient.startRuntimeSession",
				],
			},
			{
				title: "First Prompt Persists Session",
				summary:
					"On first user prompt submission, core persists session row/manifest/messages paths and begins the turn.",
				transport: "rpc",
				packages: [
					"@clinebot/agents",
					"@clinebot/llms",
					"@clinebot/rpc",
					"@clinebot/core",
					"RPC Server",
				],
				methods: [
					"SendRuntimeSession",
					"createRootSessionWithArtifacts",
					"runtime.chat.* events",
				],
			},
			{
				title: "Streaming + Persistence",
				summary:
					"Clients consume StreamEvents while core persists transcript/messages.",
				transport: "rpc",
				packages: [
					"@clinebot/rpc",
					"@clinebot/core",
					"@clinebot/cli",
					"@clinebot/code",
				],
				methods: [
					"StreamEvents",
					"PublishEvent",
					"messages.json / hooks.jsonl",
				],
			},
			{
				title: "Session Finalized",
				summary:
					"Result is returned; status moves to completed/failed/cancelled.",
				transport: "local",
				packages: [
					"@clinebot/core",
					"@clinebot/rpc",
					"@clinebot/cli",
					"@clinebot/code",
				],
				methods: [
					"UpdateSession",
					"AbortRuntimeSession",
					"updateSessionStatus",
				],
			},
		],
	},
	coreRpc: {
		title: "Core + RPC Package Lifecycle",
		steps: [
			{
				title: "Core Barrel Import",
				summary:
					"packages/core/src/index.ts exports public contracts, tools, schemas, and storage helpers.",
				transport: "local",
				packages: [
					"@clinebot/core",
					"@clinebot/shared",
					"@clinebot/agents",
					"@clinebot/llms",
					"@clinebot/rpc",
				],
				methods: [
					"index.ts re-exports",
					"resolveSessionDataDir",
					"ProviderSettingsManager",
				],
			},
			{
				title: "RPC Surface Import",
				summary:
					"packages/rpc/src/index.ts exposes RpcSessionClient, RpcRuntimeChatClient, and lifecycle helpers.",
				transport: "local",
				packages: ["@clinebot/rpc", "RPC Server"],
				methods: [
					"RpcSessionClient",
					"RpcRuntimeChatClient",
					"runRpcRuntimeEventBridge",
					"startRpcServer",
					"registerRpcClient",
				],
			},
			{
				title: "Server Boot with Backend",
				summary:
					"Host injects session backend (createSqliteRpcSessionBackend from core/server).",
				transport: "rpc",
				packages: [
					"@clinebot/core",
					"@clinebot/rpc",
					"@clinebot/cli",
					"RPC Server",
				],
				methods: [
					"createSqliteRpcSessionBackend",
					"startRpcServer({ sessionBackend })",
				],
			},
			{
				title: "Runtime Handlers Wired",
				summary:
					"CLI rpc-runtime attaches Start/Send/Abort handler implementations into server.",
				transport: "rpc",
				packages: [
					"@clinebot/cli",
					"@clinebot/rpc",
					"@clinebot/core",
					"@clinebot/agents",
					"RPC Server",
				],
				methods: [
					"createRpcRuntimeHandlers",
					"StartRuntimeSession",
					"SendRuntimeSession",
				],
			},
			{
				title: "Clients Interact",
				summary:
					"CLI/Code use RpcSessionClient unary + stream calls against gateway.",
				transport: "rpc",
				packages: [
					"@clinebot/cli",
					"@clinebot/code",
					"@clinebot/rpc",
					"RPC Server",
				],
				methods: ["PublishEvent", "StreamEvents", "RunProviderAction"],
			},
		],
	},
	cli: {
		title: "CLI Prompt -> RPC Server Flow",
		steps: [
			{
				title: "User Runs clite Prompt",
				summary: "CLI builds session config and calls session manager.",
				transport: "local",
				packages: ["@clinebot/cli", "@clinebot/core"],
				methods: ["createDefaultCliSessionManager"],
			},
			{
				title: "Ensure RPC or Fallback",
				summary:
					"CLI checks RPC health, may spawn detached rpc start, else falls back to local CoreSessionService.",
				transport: "local",
				packages: [
					"@clinebot/cli",
					"@clinebot/rpc",
					"@clinebot/core",
					"RPC Server",
				],
				methods: [
					"ensureRpcAddressViaCli",
					"getRpcServerHealth",
					"startRpcServerInBackground",
				],
			},
			{
				title: "StartRuntimeSession",
				summary: "CLI sends RpcChatStartSessionRequest over RpcSessionClient.",
				transport: "rpc",
				packages: ["@clinebot/cli", "@clinebot/rpc", "RPC Server"],
				methods: [
					"RpcSessionClient.startRuntimeSession",
					"StartRuntimeSession",
				],
			},
			{
				title: "StreamEvents Subscription",
				summary:
					"CLI subscribes to runtime.chat.text_delta/tool events before send.",
				transport: "rpc",
				packages: ["@clinebot/cli", "@clinebot/rpc", "RPC Server"],
				methods: ["RpcSessionClient.streamEvents", "runtime.chat.tool_call_*"],
			},
			{
				title: "SendRuntimeSession",
				summary: "CLI sends turn request and receives final result_json.",
				transport: "rpc",
				packages: [
					"@clinebot/cli",
					"@clinebot/rpc",
					"@clinebot/agents",
					"@clinebot/llms",
					"RPC Server",
				],
				methods: ["RpcSessionClient.sendRuntimeSession", "SendRuntimeSession"],
			},
			{
				title: "Render + Stop Stream",
				summary: "CLI merges streamed chunks with final result and ends turn.",
				transport: "local",
				packages: ["@clinebot/cli", "@clinebot/core"],
				methods: ["emitAgentEvent", "toAgentResult"],
			},
		],
	},
	code: {
		title: "Code App Prompt -> RPC Server Flow",
		steps: [
			{
				title: "Desktop Startup RPC Ensure",
				summary:
					"Tauri runs clite rpc ensure --json, sets CLINE_RPC_ADDRESS, then rpc register.",
				transport: "rpc",
				packages: [
					"@clinebot/code",
					"@clinebot/cli",
					"@clinebot/rpc",
					"RPC Server",
				],
				methods: ["rpc ensure", "rpc register", "getRpcServerHealth"],
			},
			{
				title: "Persistent Host WebSocket",
				summary:
					"UI opens one socket from get_chat_ws_endpoint and sends chat command envelopes.",
				transport: "ws",
				packages: ["@clinebot/code"],
				methods: ["get_chat_ws_endpoint", "{requestId, request}"],
			},
			{
				title: "Create Session Script",
				summary:
					"Tauri script chat-create-session.ts calls StartRuntimeSession.",
				transport: "rpc",
				packages: ["@clinebot/code", "@clinebot/rpc", "RPC Server"],
				methods: ["chat-create-session.ts", "StartRuntimeSession"],
			},
			{
				title: "Long-lived Stream Bridge",
				summary:
					"chat-stream-events.ts uses shared runRpcRuntimeEventBridge(...) to keep StreamEvents active for selected session ids.",
				transport: "rpc",
				packages: ["@clinebot/code", "@clinebot/rpc", "RPC Server"],
				methods: [
					"chat-stream-events.ts",
					"runRpcRuntimeEventBridge",
					"StreamEvents",
					"runtime.chat.text_delta",
				],
			},
			{
				title: "Turn Send Script",
				summary:
					"chat-agent-turn.ts uses shared RpcRuntimeChatClient.sendSession and emits final result line.",
				transport: "rpc",
				packages: [
					"@clinebot/code",
					"@clinebot/rpc",
					"@clinebot/core",
					"@clinebot/agents",
					"RPC Server",
				],
				methods: [
					"chat-agent-turn.ts",
					"RpcRuntimeChatClient.sendSession",
					"SendRuntimeSession",
				],
			},
			{
				title: "Broadcast to UI",
				summary:
					"Tauri maps stream lines into chat_event and compatibility agent://chunk.",
				transport: "ws",
				packages: ["@clinebot/code"],
				methods: ["{type:'chat_event',event}", "agent://chunk"],
			},
		],
	},
	desktop: {
		title: "Desktop App Chat + Discovery Flow",
		steps: [
			{
				title: "Desktop Startup RPC Ensure",
				summary:
					"Tauri runs clite rpc ensure --json, sets CLINE_RPC_ADDRESS, then rpc register.",
				transport: "rpc",
				packages: [
					"@clinebot/desktop",
					"@clinebot/cli",
					"@clinebot/rpc",
					"RPC Server",
				],
				methods: ["rpc ensure", "rpc register", "bootstrap_rpc_gateway"],
			},
			{
				title: "Persistent Host WebSocket",
				summary:
					"UI opens one socket from get_chat_ws_endpoint and sends chat command envelopes.",
				transport: "ws",
				packages: ["@clinebot/desktop"],
				methods: ["get_chat_ws_endpoint", "{requestId, request}"],
			},
			{
				title: "Shared Runtime Bridge Scripts",
				summary:
					"Desktop chat scripts call RpcRuntimeChatClient and shared runRpcRuntimeEventBridge helper.",
				transport: "rpc",
				packages: ["@clinebot/desktop", "@clinebot/rpc", "RPC Server"],
				methods: [
					"chat-create-session.ts",
					"chat-agent-turn.ts",
					"chat-stream-events.ts",
				],
			},
			{
				title: "CLI Session Discovery (Kanban)",
				summary:
					"Desktop polls list_cli_sessions/read_session_hooks; bun binary fallback keeps discovery working when PATH differs in Tauri runtime.",
				transport: "local",
				packages: ["@clinebot/desktop", "@clinebot/cli"],
				methods: [
					"list_cli_sessions",
					"read_session_hooks",
					"bun_binary_candidates",
				],
			},
		],
	},
	agentRuntime: {
		title: "Agent Runtime Modular Flow",
		steps: [
			{
				title: "Agent Composition Root",
				summary:
					"Agent constructor wires ConversationStore, LifecycleOrchestrator, TurnProcessor, ToolOrchestrator, and AgentRuntimeBus.",
				transport: "local",
				packages: ["@clinebot/agents"],
				methods: [
					"new ConversationStore(...)",
					"new LifecycleOrchestrator(...)",
					"new TurnProcessor(...)",
					"new ToolOrchestrator(...)",
					"createAgentRuntimeBus()",
				],
			},
			{
				title: "Run Guard + Input Stage",
				summary:
					"run()/continue() enforce single active-run semantics, initialize extensions once, then dispatch input hook stage.",
				transport: "local",
				packages: ["@clinebot/agents"],
				methods: [
					"assertCanStartRun()",
					"ensureExtensionsInitialized()",
					"hook.input",
				],
			},
			{
				title: "Lifecycle Dispatch Orchestration",
				summary:
					"LifecycleOrchestrator emits lifecycle events and dispatches HookEngine stages with merged control (cancel/context/systemPrompt/appendMessages).",
				transport: "local",
				packages: ["@clinebot/agents"],
				methods: [
					"LifecycleOrchestrator.dispatch(...)",
					"HookEngine.dispatch(...)",
					"appendHookContext(...)",
				],
			},
			{
				title: "Turn Processing",
				summary:
					"TurnProcessor builds API-safe messages, streams model chunks, emits runtime events, and finalizes assistant/tool_use content.",
				transport: "local",
				packages: ["@clinebot/agents", "@clinebot/llms"],
				methods: [
					"MessageBuilder.buildForApi(...)",
					"handler.createMessage(...)",
					"TurnProcessor.processTurn(...)",
				],
			},
			{
				title: "Bounded Tool Execution",
				summary:
					"ToolOrchestrator executes tool calls with lifecycle before/after hooks and bounded parallelism using maxParallelToolCalls.",
				transport: "local",
				packages: ["@clinebot/agents"],
				methods: [
					"ToolOrchestrator.execute(...)",
					"executeToolsInParallel(..., { maxConcurrency })",
					"hook.tool_call_before / hook.tool_call_after",
				],
			},
			{
				title: "Run Completion",
				summary:
					"Agent emits done event, dispatches run_end, drains hook queues, and returns final AgentResult.",
				transport: "local",
				packages: ["@clinebot/agents"],
				methods: [
					"emit({type:'done'})",
					"hook.run_end",
					"HookEngine.shutdown()",
				],
			},
		],
	},
	agentTeamLoop: {
		title: "Agent Team Lifecycle (During Agent Loop)",
		steps: [
			{
				title: "Runtime Build Enables Team Mode",
				summary:
					"Core runtime builder normalizes config, creates FileTeamPersistenceStore, and eagerly ensures AgentTeamsRuntime when enableAgentTeams is true.",
				transport: "local",
				packages: ["@clinebot/core", "@clinebot/agents", "@clinebot/shared"],
				methods: [
					"DefaultRuntimeBuilder.build(...)",
					"new FileTeamPersistenceStore(...)",
					"ensureTeamRuntime()",
				],
			},
			{
				title: "Restore Team State + Teammate Specs",
				summary:
					"Persisted team state and teammate specs are loaded from team data dir and hydrated into the in-memory runtime before turn execution.",
				transport: "local",
				packages: ["@clinebot/core", "@clinebot/agents", "@clinebot/shared"],
				methods: [
					"FileTeamPersistenceStore.loadState()",
					"getTeammateSpecs()",
					"AgentTeamsRuntime.hydrateState(...)",
				],
			},
			{
				title: "Bootstrap Team Tools",
				summary:
					"bootstrapAgentTeams registers lead team tools (team_member/team_task/team_message/team_status) and optionally respawns restored teammates.",
				transport: "local",
				packages: ["@clinebot/agents", "@clinebot/core"],
				methods: [
					"bootstrapAgentTeams(...)",
					"createAgentTeamsTools(...)",
					"spawnTeamTeammate(...)",
				],
			},
			{
				title: "Agent Loop Emits Team Events",
				summary:
					"As lead/teammates run, runtime emits teammate/task/message/mission-log events through onTeamEvent callback while standard agent loop continues.",
				transport: "local",
				packages: ["@clinebot/agents", "@clinebot/core"],
				methods: [
					"AgentTeamsRuntime.emitEvent(...)",
					"onTeamEvent(event)",
					"task_start/task_end/team_task_updated/team_message/team_mission_log",
				],
			},
			{
				title: "Persist Team State + History",
				summary:
					"Core appends team event JSONL history and persists current team envelope (or clears empty state) after each team event.",
				transport: "local",
				packages: ["@clinebot/core", "@clinebot/shared"],
				methods: [
					"appendTaskHistory(event)",
					"persist(teamRuntime)",
					"hasPersistableState(...)",
				],
			},
			{
				title: "Mirror Team Task Sub-sessions",
				summary:
					"Session service maps team task start/end into child sub-sessions so transcript, status, and messages remain aligned with team task execution.",
				transport: "local",
				packages: ["@clinebot/core", "@clinebot/agents"],
				methods: [
					"onTeamTaskStart(...)",
					"createTeamTaskSubSession(...)",
					"onTeamTaskEnd(...)",
				],
			},
			{
				title: "Turn End + Runtime Shutdown",
				summary:
					"On run completion or shutdown, core updates root/sub-session status and runtime shutdown path tears down active teammates safely.",
				transport: "local",
				packages: ["@clinebot/core", "@clinebot/agents"],
				methods: [
					"updateSessionStatus(...)",
					"shutdownTeamRuntime(...)",
					"AgentTeamsRuntime.shutdownTeammate(...)",
				],
			},
		],
	},
	hooksPlugins: {
		title: "Hooks + Plugin System Flow",
		steps: [
			{
				title: "Extension Manifest Validation",
				summary:
					"ContributionRegistry validates extension capabilities + declared hookStages before setup/activation.",
				transport: "local",
				packages: ["@clinebot/agents"],
				methods: [
					"ContributionRegistry.resolve()",
					"ContributionRegistry.validate()",
				],
			},
			{
				title: "Contribution Setup",
				summary:
					"Extensions register tools/commands/shortcuts/flags/renderers/providers during setup phase.",
				transport: "local",
				packages: ["@clinebot/agents"],
				methods: [
					"ContributionRegistry.setup()",
					"registerTool()",
					"registerCommand()",
				],
			},
			{
				title: "Lifecycle Handler Registration",
				summary:
					"registerLifecycleHandlers binds app hooks and extension handlers to HookEngine by stage with deterministic naming/order.",
				transport: "local",
				packages: ["@clinebot/agents"],
				methods: ["registerLifecycleHandlers(...)", "HookEngine.register(...)"],
			},
			{
				title: "Runtime Event Fanout",
				summary:
					"AgentRuntimeBus broadcasts runtime events to onEvent subscribers and to runtime_event hook dispatch.",
				transport: "local",
				packages: ["@clinebot/agents"],
				methods: [
					"subscribeEvents(...)",
					"emitRuntimeEvent(...)",
					"hook.runtime_event",
				],
			},
			{
				title: "Expanded Extension Stages",
				summary:
					"Extensions can intercept run_start/run_end, iteration_start/iteration_end, turn_start, before_agent_start, tool_call_* and error/session stages.",
				transport: "local",
				packages: ["@clinebot/agents"],
				methods: [
					"manifest.hookStages",
					"onRunStart/onRunEnd",
					"onIterationStart/onIterationEnd",
					"onTurnStart/onBeforeAgentStart",
				],
			},
			{
				title: "Policy + Reliability Controls",
				summary:
					"HookEngine applies per-stage/per-handler timeout, retry, failure mode, and queue/concurrency policy; handlers are sorted at registration time.",
				transport: "local",
				packages: ["@clinebot/agents"],
				methods: [
					"HookEngine.resolveStagePolicy(...)",
					"HookEngine.executeHandlers(...)",
					"register(...) sort by priority/name",
				],
			},
		],
	},
};

export const sourceAnchors = [
	"packages/core/src/index.ts",
	"packages/rpc/src/index.ts",
	"packages/rpc/src/runtime-chat-client.ts",
	"packages/rpc/src/runtime-chat-stream-bridge.ts",
	"apps/cli/src/utils/session.ts",
	"apps/cli/src/commands/rpc.ts",
	"apps/code/scripts/chat-create-session.ts",
	"apps/code/scripts/chat-agent-turn.ts",
	"apps/code/scripts/chat-stream-events.ts",
	"apps/desktop/scripts/chat-stream-events.ts",
	"packages/agents/src/agent.ts",
	"packages/agents/src/runtime/*.ts",
	"packages/agents/src/teams/team-tools.ts",
	"packages/agents/src/teams/multi-agent.ts",
	"packages/agents/src/hooks/engine.ts",
	"packages/agents/src/hooks/lifecycle.ts",
	"packages/agents/src/extensions.ts",
	"packages/core/src/runtime/runtime-builder.ts",
	"packages/core/src/session/session-service.ts",
];
