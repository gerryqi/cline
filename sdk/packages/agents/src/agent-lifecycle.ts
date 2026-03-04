import type { HookEngine, HookHandler } from "./hook-engine.js";
import type { AgentConfig } from "./types.js";

type LifecycleConfig = Pick<AgentConfig, "hooks" | "extensions">;

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
		const order = String(index).padStart(4, "0");
		const extensionName = extension.name || `extension_${order}`;
		const base = `${order}:${extensionName}`;
		if (extension.onInput) {
			register({
				name: `${base}.onInput`,
				stage: "input",
				handle: (event) => extension.onInput?.(event.payload as never),
			});
		}
		if (extension.onSessionStart) {
			register({
				name: `${base}.onSessionStart`,
				stage: "session_start",
				handle: (event) => extension.onSessionStart?.(event.payload as never),
			});
		}
		if (extension.onBeforeAgentStart) {
			register({
				name: `${base}.onBeforeAgentStart`,
				stage: "before_agent_start",
				handle: (event) =>
					extension.onBeforeAgentStart?.(event.payload as never),
			});
		}
		if (extension.onToolCall) {
			register({
				name: `${base}.onToolCall`,
				stage: "tool_call_before",
				handle: (event) => extension.onToolCall?.(event.payload as never),
			});
		}
		if (extension.onToolResult) {
			register({
				name: `${base}.onToolResult`,
				stage: "tool_call_after",
				handle: (event) => extension.onToolResult?.(event.payload as never),
			});
		}
		if (extension.onAgentEnd) {
			register({
				name: `${base}.onAgentEnd`,
				stage: "turn_end",
				handle: (event) => extension.onAgentEnd?.(event.payload as never),
			});
		}
		if (extension.onSessionShutdown) {
			register({
				name: `${base}.onSessionShutdown`,
				stage: "session_shutdown",
				handle: (event) =>
					extension.onSessionShutdown?.(event.payload as never),
			});
		}
		if (extension.onError) {
			register({
				name: `${base}.onError`,
				stage: "error",
				handle: async (event) => {
					await extension.onError?.(event.payload as never);
					return undefined;
				},
			});
		}
		if (extension.onRuntimeEvent) {
			register({
				name: `${base}.onRuntimeEvent`,
				stage: "runtime_event",
				handle: async (event) => {
					await extension.onRuntimeEvent?.(event.payload as never);
					return undefined;
				},
			});
		}
	}
}
