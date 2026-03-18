import type {
	AgentHooks,
	HookEventPayload,
	RunHookResult,
} from "@clinebot/agents";
import { createSubprocessHooks } from "@clinebot/agents";
import type { HookSessionContext } from "@clinebot/shared";
import { formatHookDispatchOutput } from "../commands/hook";
import { closeInlineStreamIfNeeded } from "./events";
import {
	c,
	emitJsonLine,
	getActiveCliSession,
	getCurrentOutputMode,
	write,
	writeErr,
} from "./output";

const isDev = process.env.NODE_ENV === "development";

function getHookCommand(): string[] | undefined {
	if (!process.argv[1]) {
		return undefined;
	}
	return [process.execPath, process.argv[1], "hook"];
}

export function currentHookSessionContext(): HookSessionContext | undefined {
	const session = getActiveCliSession();
	if (!session) {
		return undefined;
	}
	return {
		rootSessionId: session.manifest.session_id,
		hookLogPath: session.hookPath,
	};
}

function writeHookInvocation(
	payload: HookEventPayload,
	result?: RunHookResult,
): void {
	if (getCurrentOutputMode() === "json") {
		emitJsonLine("stdout", {
			type: "hook_event",
			hookEventName: payload.hookName,
			hookOutput: result?.parsedJson,
			agentId: payload.agent_id,
			taskId: payload.taskId,
			parentAgentId: payload.parent_agent_id,
		});
		return;
	}
	closeInlineStreamIfNeeded();
	const hookName = payload.hookName;
	const toolName =
		payload.hookName === "tool_call"
			? payload.tool_call.name
			: payload.hookName === "tool_result"
				? payload.tool_result.name
				: undefined;
	const details = toolName ? ` ${c.cyan}${toolName}${c.reset}` : "";
	const output = formatHookDispatchOutput(result);
	if (output) {
		write(
			`\n${c.dim}[hook:${hookName}]${c.reset}${details} ${c.dim}-> ${output}${c.reset}\n`,
		);
		return;
	}
	if (details) {
		write(`\n${c.dim}[hook:${hookName}]${c.reset}${details}\n`);
	}
}

export function createRuntimeHooks(): AgentHooks | undefined {
	const command = getHookCommand();
	if (!command) {
		return undefined;
	}
	return createSubprocessHooks({
		command,
		env: process.env,
		cwd: process.cwd(),
		sessionContext: currentHookSessionContext,
		onDispatchError: (error: Error) => {
			if (isDev) {
				writeErr(`hook dispatch failed: ${error.message}`);
			}
		},
		onDispatch: ({ payload, result }) => {
			writeHookInvocation(payload, result);
		},
	}).hooks;
}
