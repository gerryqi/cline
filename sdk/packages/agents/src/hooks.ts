import { spawn } from "node:child_process";
import type {
	AgentHookControl,
	AgentHooks,
	AgentHookToolCallEndContext,
	AgentHookToolCallStartContext,
	AgentHookTurnEndContext,
	ToolCallRecord,
} from "./types.js";

export type HookEventName =
	| "tool_call"
	| "tool_result"
	| "agent_end"
	| "session_shutdown";

export interface HookEventPayloadBase {
	hook_event_name: HookEventName;
	agent_id: string;
	conversation_id: string;
	parent_agent_id: string | null;
}

export interface ToolCallHookPayload extends HookEventPayloadBase {
	hook_event_name: "tool_call";
	iteration: number;
	tool_call: {
		id: string;
		name: string;
		input: unknown;
	};
}

export interface ToolResultHookPayload extends HookEventPayloadBase {
	hook_event_name: "tool_result";
	iteration: number;
	tool_result: ToolCallRecord;
}

export interface AgentEndHookPayload extends HookEventPayloadBase {
	hook_event_name: "agent_end";
	iteration: number;
	turn: AgentHookTurnEndContext["turn"];
}

export interface SessionShutdownHookPayload extends HookEventPayloadBase {
	hook_event_name: "session_shutdown";
	reason?: string;
}

export type HookEventPayload =
	| ToolCallHookPayload
	| ToolResultHookPayload
	| AgentEndHookPayload
	| SessionShutdownHookPayload;

export interface RunHookOptions {
	command?: string[];
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	detached?: boolean;
}

export interface RunHookResult {
	exitCode: number | null;
	stdout: string;
	stderr: string;
	parsedJson?: unknown;
}

const DEFAULT_HOOK_COMMAND = ["agent", "hook"];

/**
 * Dispatch a single hook event to an external CLI.
 * Payload is serialized as JSON and piped via stdin.
 */
export async function runHook(
	payload: HookEventPayload,
	options: RunHookOptions = {},
): Promise<RunHookResult | undefined> {
	const command = options.command ?? DEFAULT_HOOK_COMMAND;
	if (command.length === 0) {
		throw new Error("runHook requires a non-empty command");
	}
	const detached = !!options.detached;

	const child = spawn(command[0], command.slice(1), {
		cwd: options.cwd,
		env: options.env,
		stdio: detached ? ["pipe", "ignore", "ignore"] : ["pipe", "pipe", "pipe"],
		detached,
	});

	const body = JSON.stringify(payload);
	if (!child.stdin) {
		throw new Error("runHook failed to create stdin pipe");
	}
	child.stdin.write(body);
	child.stdin.end();

	if (detached) {
		await new Promise<void>((resolve, reject) => {
			child.once("error", reject);
			child.once("spawn", () => resolve());
		});
		child.unref();
		return;
	}

	let stdout = "";
	let stderr = "";
	if (!child.stdout || !child.stderr) {
		throw new Error("runHook failed to create stdout/stderr pipes");
	}
	child.stdout.on("data", (chunk: Buffer | string) => {
		stdout += chunk.toString();
	});
	child.stderr.on("data", (chunk: Buffer | string) => {
		stderr += chunk.toString();
	});

	return await new Promise<RunHookResult>((resolve, reject) => {
		child.once("error", reject);
		child.once("close", (exitCode) => {
			let parsedJson: unknown;
			const trimmed = stdout.trim();
			if (trimmed) {
				try {
					parsedJson = JSON.parse(trimmed);
				} catch {
					parsedJson = undefined;
				}
			}
			resolve({
				exitCode,
				stdout,
				stderr,
				parsedJson,
			});
		});
	});
}

export interface SubprocessHooksOptions {
	command?: string[];
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	/**
	 * Optional callback for non-fatal hook dispatch errors.
	 */
	onDispatchError?: (error: Error, payload: HookEventPayload) => void;
}

export interface SubprocessHookControl {
	hooks: AgentHooks;
	shutdown: (ctx: {
		agentId: string;
		conversationId: string;
		parentAgentId: string | null;
		reason?: string;
	}) => Promise<void>;
}

function toError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

function toHookControl(value: unknown): AgentHookControl | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}

	const maybe = value as Record<string, unknown>;
	const hasControlKey =
		"cancel" in maybe || "context" in maybe || "overrideInput" in maybe;
	if (!hasControlKey) {
		return undefined;
	}

	return {
		cancel: typeof maybe.cancel === "boolean" ? maybe.cancel : undefined,
		context: typeof maybe.context === "string" ? maybe.context : undefined,
		overrideInput: Object.hasOwn(maybe, "overrideInput")
			? maybe.overrideInput
			: undefined,
	};
}

async function dispatchDetached(
	payload: HookEventPayload,
	options: SubprocessHooksOptions,
): Promise<void> {
	try {
		await runHook(payload, {
			command: options.command,
			cwd: options.cwd,
			env: options.env,
			detached: true,
		});
	} catch (error) {
		options.onDispatchError?.(toError(error), payload);
	}
}

/**
 * Create lifecycle hooks that mirror Pi-style hook events:
 * - tool_call (blocking)
 * - tool_result (fire-and-forget)
 * - agent_end (fire-and-forget)
 * - session_shutdown (fire-and-forget via returned `shutdown()`)
 */
export function createSubprocessHooks(
	options: SubprocessHooksOptions = {},
): SubprocessHookControl {
	const onToolCallStart = async (
		ctx: AgentHookToolCallStartContext,
	): Promise<AgentHookControl | undefined> => {
		const payload: ToolCallHookPayload = {
			hook_event_name: "tool_call",
			agent_id: ctx.agentId,
			conversation_id: ctx.conversationId,
			parent_agent_id: ctx.parentAgentId,
			iteration: ctx.iteration,
			tool_call: {
				id: ctx.call.id,
				name: ctx.call.name,
				input: ctx.call.input,
			},
		};

		try {
			const result = await runHook(payload, {
				command: options.command,
				cwd: options.cwd,
				env: options.env,
				detached: false,
			});
			return toHookControl(result?.parsedJson);
		} catch (error) {
			options.onDispatchError?.(toError(error), payload);
			return;
		}
	};

	const onToolCallEnd = async (
		ctx: AgentHookToolCallEndContext,
	): Promise<AgentHookControl | undefined> => {
		const payload: ToolResultHookPayload = {
			hook_event_name: "tool_result",
			agent_id: ctx.agentId,
			conversation_id: ctx.conversationId,
			parent_agent_id: ctx.parentAgentId,
			iteration: ctx.iteration,
			tool_result: ctx.record,
		};
		await dispatchDetached(payload, options);
		return undefined;
	};

	const onTurnEnd = async (
		ctx: AgentHookTurnEndContext,
	): Promise<AgentHookControl | undefined> => {
		const payload: AgentEndHookPayload = {
			hook_event_name: "agent_end",
			agent_id: ctx.agentId,
			conversation_id: ctx.conversationId,
			parent_agent_id: ctx.parentAgentId,
			iteration: ctx.iteration,
			turn: ctx.turn,
		};
		await dispatchDetached(payload, options);
		return undefined;
	};

	const shutdown = async (ctx: {
		agentId: string;
		conversationId: string;
		parentAgentId: string | null;
		reason?: string;
	}): Promise<void> => {
		const payload: SessionShutdownHookPayload = {
			hook_event_name: "session_shutdown",
			agent_id: ctx.agentId,
			conversation_id: ctx.conversationId,
			parent_agent_id: ctx.parentAgentId,
			reason: ctx.reason,
		};
		await dispatchDetached(payload, options);
	};

	return {
		hooks: {
			onToolCallStart,
			onToolCallEnd,
			onTurnEnd,
			onSessionShutdown: async ({
				agentId,
				conversationId,
				parentAgentId,
				reason,
			}) => {
				await shutdown({ agentId, conversationId, parentAgentId, reason });
				return undefined;
			},
		},
		shutdown,
	};
}
