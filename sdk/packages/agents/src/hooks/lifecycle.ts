import type {
	AgentConfig,
	AgentExtension,
	AgentExtensionHookStage,
	AgentHookControl,
} from "../types.js";
import type { HookEngine, HookHandler } from "./engine.js";

type LifecycleConfig = Pick<AgentConfig, "hooks" | "extensions">;

const EXTENSION_STAGE_HANDLERS: ReadonlyArray<{
	stage: AgentExtensionHookStage;
	handler: (
		extension: AgentExtension,
		event: { payload: unknown },
	) => Promise<AgentHookControl | undefined> | AgentHookControl | undefined;
	name: string;
}> = [
	{
		stage: "input",
		name: "onInput",
		handler: (extension, event) =>
			extension.onInput?.(event.payload as never) as
				| AgentHookControl
				| undefined,
	},
	{
		stage: "session_start",
		name: "onSessionStart",
		handler: (extension, event) =>
			extension.onSessionStart?.(event.payload as never) as
				| AgentHookControl
				| undefined,
	},
	{
		stage: "run_start",
		name: "onRunStart",
		handler: (extension, event) =>
			extension.onRunStart?.(event.payload as never) as
				| AgentHookControl
				| undefined,
	},
	{
		stage: "iteration_start",
		name: "onIterationStart",
		handler: (extension, event) =>
			extension.onIterationStart?.(event.payload as never) as
				| AgentHookControl
				| undefined,
	},
	{
		stage: "turn_start",
		name: "onTurnStart",
		handler: (extension, event) =>
			extension.onTurnStart?.(event.payload as never) as
				| AgentHookControl
				| undefined,
	},
	{
		stage: "before_agent_start",
		name: "onBeforeAgentStart",
		handler: (extension, event) =>
			extension.onBeforeAgentStart?.(event.payload as never) as
				| AgentHookControl
				| undefined,
	},
	{
		stage: "tool_call_before",
		name: "onToolCall",
		handler: (extension, event) =>
			extension.onToolCall?.(event.payload as never) as
				| AgentHookControl
				| undefined,
	},
	{
		stage: "tool_call_after",
		name: "onToolResult",
		handler: (extension, event) =>
			extension.onToolResult?.(event.payload as never) as
				| AgentHookControl
				| undefined,
	},
	{
		stage: "turn_end",
		name: "onAgentEnd",
		handler: (extension, event) =>
			extension.onAgentEnd?.(event.payload as never) as
				| AgentHookControl
				| undefined,
	},
	{
		stage: "iteration_end",
		name: "onIterationEnd",
		handler: async (extension, event) => {
			await extension.onIterationEnd?.(event.payload as never);
			return undefined;
		},
	},
	{
		stage: "run_end",
		name: "onRunEnd",
		handler: async (extension, event) => {
			await extension.onRunEnd?.(event.payload as never);
			return undefined;
		},
	},
	{
		stage: "session_shutdown",
		name: "onSessionShutdown",
		handler: (extension, event) =>
			extension.onSessionShutdown?.(event.payload as never) as
				| AgentHookControl
				| undefined,
	},
	{
		stage: "error",
		name: "onError",
		handler: async (extension, event) => {
			await extension.onError?.(event.payload as never);
			return undefined;
		},
	},
	{
		stage: "runtime_event",
		name: "onRuntimeEvent",
		handler: async (extension, event) => {
			await extension.onRuntimeEvent?.(event.payload as never);
			return undefined;
		},
	},
];

export function registerLifecycleHandlers(
	hookEngine: HookEngine,
	config: LifecycleConfig,
): void {
	const register = (handler: HookHandler): void => {
		hookEngine.register(handler);
	};
	const hooks = config.hooks;

	if (hooks?.onRunStart) {
		register({
			name: "hooks.onRunStart",
			stage: "run_start",
			handle: (event) => hooks.onRunStart?.(event.payload as never),
		});
	}
	if (hooks?.onRunEnd) {
		register({
			name: "hooks.onRunEnd",
			stage: "run_end",
			handle: async (event) => {
				await hooks.onRunEnd?.(event.payload as never);
				return undefined;
			},
		});
	}
	if (hooks?.onIterationStart) {
		register({
			name: "hooks.onIterationStart",
			stage: "iteration_start",
			handle: (event) => hooks.onIterationStart?.(event.payload as never),
		});
	}
	if (hooks?.onIterationEnd) {
		register({
			name: "hooks.onIterationEnd",
			stage: "iteration_end",
			handle: async (event) => {
				await hooks.onIterationEnd?.(event.payload as never);
				return undefined;
			},
		});
	}
	if (hooks?.onTurnStart) {
		register({
			name: "hooks.onTurnStart",
			stage: "turn_start",
			handle: (event) => hooks.onTurnStart?.(event.payload as never),
		});
	}
	if (hooks?.onTurnEnd) {
		register({
			name: "hooks.onTurnEnd",
			stage: "turn_end",
			handle: (event) => hooks.onTurnEnd?.(event.payload as never),
		});
	}
	if (hooks?.onToolCallStart) {
		register({
			name: "hooks.onToolCallStart",
			stage: "tool_call_before",
			handle: (event) => hooks.onToolCallStart?.(event.payload as never),
		});
	}
	if (hooks?.onToolCallEnd) {
		register({
			name: "hooks.onToolCallEnd",
			stage: "tool_call_after",
			handle: (event) => hooks.onToolCallEnd?.(event.payload as never),
		});
	}
	if (hooks?.onSessionShutdown) {
		register({
			name: "hooks.onSessionShutdown",
			stage: "session_shutdown",
			handle: (event) => hooks.onSessionShutdown?.(event.payload as never),
		});
	}
	if (hooks?.onError) {
		register({
			name: "hooks.onError",
			stage: "error",
			handle: async (event) => {
				await hooks.onError?.(event.payload as never);
				return undefined;
			},
		});
	}

	for (const [index, extension] of (config.extensions ?? []).entries()) {
		if (!extension.manifest.capabilities.includes("hooks")) {
			continue;
		}
		const order = String(index).padStart(4, "0");
		const extensionName = extension.name || `extension_${order}`;
		const base = `${order}:${extensionName}`;
		const subscribedStages = new Set(extension.manifest.hookStages ?? []);
		for (const stageHandler of EXTENSION_STAGE_HANDLERS) {
			if (!subscribedStages.has(stageHandler.stage)) {
				continue;
			}
			register({
				name: `${base}.${stageHandler.name}`,
				stage: stageHandler.stage,
				handle: (event) => stageHandler.handler(extension, event),
			});
		}
	}
}
