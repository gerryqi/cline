import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
	type AgentHooks,
	type HookEventName,
	type HookEventPayload,
	runHook,
} from "@cline/agents";
import type { BasicLogger, HookSessionContext } from "@cline/shared";
import { listHookConfigFiles } from "../agents/hooks-config-loader";

type HookContextBase = {
	agentId: string;
	conversationId: string;
	parentAgentId: string | null;
};

type AgentHookControl = NonNullable<
	Awaited<ReturnType<NonNullable<AgentHooks["onToolCallStart"]>>>
>;
type AgentHookRunStartContext = Parameters<
	NonNullable<AgentHooks["onRunStart"]>
>[0];
type AgentHookToolCallStartContext = Parameters<
	NonNullable<AgentHooks["onToolCallStart"]>
>[0];
type AgentHookToolCallEndContext = Parameters<
	NonNullable<AgentHooks["onToolCallEnd"]>
>[0];
type AgentHookTurnEndContext = Parameters<
	NonNullable<AgentHooks["onTurnEnd"]>
>[0];
type AgentHookSessionShutdownContext = Parameters<
	NonNullable<AgentHooks["onSessionShutdown"]>
>[0];

type HookRuntimeOptions = {
	cwd: string;
	workspacePath: string;
	hookLogPath?: string;
	rootSessionId?: string;
	logger?: BasicLogger;
	toolCallTimeoutMs?: number;
};

function mapParams(input: unknown): Record<string, string> {
	if (!input || typeof input !== "object") {
		return {};
	}
	const output: Record<string, string> = {};
	for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
		output[key] = typeof value === "string" ? value : JSON.stringify(value);
	}
	return output;
}

function logHookError(
	logger: BasicLogger | undefined,
	message: string,
	error?: unknown,
): void {
	const detail = error instanceof Error ? `: ${error.message}` : "";
	const text = `${message}${detail}`;
	if (logger?.warn) {
		logger.warn(text);
		return;
	}
	console.warn(text);
}

function mergeHookControls(
	current: AgentHookControl | undefined,
	next: AgentHookControl | undefined,
): AgentHookControl | undefined {
	if (!next) {
		return current;
	}
	if (!current) {
		return { ...next };
	}
	const contexts = [current.context, next.context]
		.filter(
			(value): value is string => typeof value === "string" && value.length > 0,
		)
		.join("\n");
	const appendMessages = [
		...(current.appendMessages ?? []),
		...(next.appendMessages ?? []),
	];
	return {
		cancel: current.cancel === true || next.cancel === true ? true : undefined,
		context: contexts || undefined,
		overrideInput:
			next.overrideInput !== undefined
				? next.overrideInput
				: current.overrideInput,
		systemPrompt:
			next.systemPrompt !== undefined
				? next.systemPrompt
				: current.systemPrompt,
		appendMessages: appendMessages.length > 0 ? appendMessages : undefined,
	};
}

function parseHookControl(value: unknown): AgentHookControl | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	const context =
		typeof record.context === "string"
			? record.context
			: typeof record.contextModification === "string"
				? record.contextModification
				: typeof record.errorMessage === "string"
					? record.errorMessage
					: undefined;
	return {
		cancel: typeof record.cancel === "boolean" ? record.cancel : undefined,
		context,
		overrideInput: Object.hasOwn(record, "overrideInput")
			? record.overrideInput
			: undefined,
	};
}

function isAbortReason(reason?: string): boolean {
	const value = String(reason ?? "").toLowerCase();
	return (
		value.includes("cancel") ||
		value.includes("abort") ||
		value.includes("interrupt")
	);
}

function ensureHookLogDir(filePath: string): void {
	const parent = dirname(filePath);
	if (!existsSync(parent)) {
		mkdirSync(parent, { recursive: true });
	}
}

function createPayloadBase(
	ctx: HookContextBase,
	options: HookRuntimeOptions,
): Omit<HookEventPayload, "hookName"> {
	const userId =
		process.env.CLINE_USER_ID?.trim() || process.env.USER?.trim() || "unknown";
	const sessionContext: HookSessionContext = {
		rootSessionId: options.rootSessionId || ctx.conversationId,
		hookLogPath: options.hookLogPath,
	};
	return {
		clineVersion: process.env.CLINE_VERSION?.trim() || "",
		timestamp: new Date().toISOString(),
		taskId: ctx.conversationId,
		sessionContext,
		workspaceRoots: options.workspacePath ? [options.workspacePath] : [],
		userId,
		agent_id: ctx.agentId,
		parent_agent_id: ctx.parentAgentId,
	} as Omit<HookEventPayload, "hookName">;
}

type HookCommandMap = Partial<Record<HookEventName, string[]>>;

function createHookCommandMap(workspacePath: string): HookCommandMap {
	const map: HookCommandMap = {};
	for (const file of listHookConfigFiles(workspacePath)) {
		if (!file.hookEventName) {
			continue;
		}
		const existing = map[file.hookEventName] ?? [];
		existing.push(file.path);
		map[file.hookEventName] = existing;
	}
	return map;
}

async function runBlockingHookCommands(options: {
	commandPaths: string[];
	payload: HookEventPayload;
	cwd: string;
	logger?: BasicLogger;
	timeoutMs?: number;
}): Promise<AgentHookControl | undefined> {
	let merged: AgentHookControl | undefined;
	for (const commandPath of options.commandPaths) {
		try {
			const result = await runHook(options.payload, {
				command: [commandPath],
				cwd: options.cwd,
				env: process.env,
				detached: false,
				timeoutMs: options.timeoutMs,
			});
			if (result?.timedOut) {
				logHookError(options.logger, `hook command timed out: ${commandPath}`);
				continue;
			}
			if (result?.parseError) {
				logHookError(
					options.logger,
					`hook command returned invalid JSON control output: ${commandPath} (${result.parseError})`,
				);
				continue;
			}
			merged = mergeHookControls(merged, parseHookControl(result?.parsedJson));
		} catch (error) {
			logHookError(
				options.logger,
				`hook command failed: ${commandPath}`,
				error,
			);
		}
	}
	return merged;
}

function runAsyncHookCommands(options: {
	commandPaths: string[];
	payload: HookEventPayload;
	cwd: string;
	logger?: BasicLogger;
}): void {
	for (const commandPath of options.commandPaths) {
		void runHook(options.payload, {
			command: [commandPath],
			cwd: options.cwd,
			env: process.env,
			detached: true,
		}).catch((error) => {
			logHookError(
				options.logger,
				`hook command failed: ${commandPath}`,
				error,
			);
		});
	}
}

export function createHookAuditHooks(options: {
	hookLogPath: string;
	rootSessionId?: string;
	workspacePath: string;
}): AgentHooks {
	const runtimeOptions: HookRuntimeOptions = {
		cwd: options.workspacePath,
		workspacePath: options.workspacePath,
		hookLogPath: options.hookLogPath,
		rootSessionId: options.rootSessionId,
	};

	const append = (payload: HookEventPayload): void => {
		const line = `${JSON.stringify({
			ts: new Date().toISOString(),
			...payload,
		})}\n`;
		ensureHookLogDir(options.hookLogPath);
		appendFileSync(options.hookLogPath, line, "utf8");
	};

	return {
		onRunStart: async (ctx: AgentHookRunStartContext) => {
			append({
				...createPayloadBase(ctx, runtimeOptions),
				hookName: "agent_start",
				taskStart: { taskMetadata: {} },
			});
			append({
				...createPayloadBase(ctx, runtimeOptions),
				hookName: "prompt_submit",
				userPromptSubmit: {
					prompt: ctx.userMessage,
					attachments: [],
				},
			});
			return undefined;
		},
		onToolCallStart: async (ctx: AgentHookToolCallStartContext) => {
			append({
				...createPayloadBase(ctx, runtimeOptions),
				hookName: "tool_call",
				iteration: ctx.iteration,
				tool_call: {
					id: ctx.call.id,
					name: ctx.call.name,
					input: ctx.call.input,
				},
				preToolUse: {
					toolName: ctx.call.name,
					parameters: mapParams(ctx.call.input),
				},
			});
			return undefined;
		},
		onToolCallEnd: async (ctx: AgentHookToolCallEndContext) => {
			append({
				...createPayloadBase(ctx, runtimeOptions),
				hookName: "tool_result",
				iteration: ctx.iteration,
				tool_result: ctx.record,
				postToolUse: {
					toolName: ctx.record.name,
					parameters: mapParams(ctx.record.input),
					result:
						typeof ctx.record.output === "string"
							? ctx.record.output
							: JSON.stringify(ctx.record.output),
					success: !ctx.record.error,
					executionTimeMs: ctx.record.durationMs,
				},
			});
			return undefined;
		},
		onTurnEnd: async (ctx: AgentHookTurnEndContext) => {
			append({
				...createPayloadBase(ctx, runtimeOptions),
				hookName: "agent_end",
				iteration: ctx.iteration,
				turn: ctx.turn,
				taskComplete: { taskMetadata: {} },
			});
			return undefined;
		},
		onSessionShutdown: async (ctx: AgentHookSessionShutdownContext) => {
			if (isAbortReason(ctx.reason)) {
				append({
					...createPayloadBase(ctx, runtimeOptions),
					hookName: "agent_abort",
					reason: ctx.reason,
					taskCancel: { taskMetadata: {} },
				});
			}
			append({
				...createPayloadBase(ctx, runtimeOptions),
				hookName: "session_shutdown",
				reason: ctx.reason,
			});
			return undefined;
		},
	};
}

export function createHookConfigFileHooks(
	options: HookRuntimeOptions,
): AgentHooks | undefined {
	const commandMap = createHookCommandMap(options.workspacePath);
	const hasAnyHooks = Object.values(commandMap).some(
		(paths) => (paths?.length ?? 0) > 0,
	);
	if (!hasAnyHooks) {
		return undefined;
	}

	const runStartPayload = async (
		ctx: AgentHookRunStartContext,
	): Promise<void> => {
		const agentStart = commandMap.agent_start ?? [];
		if (agentStart.length > 0) {
			runAsyncHookCommands({
				commandPaths: agentStart,
				cwd: options.cwd,
				logger: options.logger,
				payload: {
					...createPayloadBase(ctx, options),
					hookName: "agent_start",
					taskStart: { taskMetadata: {} },
				},
			});
		}

		const promptSubmit = commandMap.prompt_submit ?? [];
		if (promptSubmit.length > 0) {
			runAsyncHookCommands({
				commandPaths: promptSubmit,
				cwd: options.cwd,
				logger: options.logger,
				payload: {
					...createPayloadBase(ctx, options),
					hookName: "prompt_submit",
					userPromptSubmit: {
						prompt: ctx.userMessage,
						attachments: [],
					},
				},
			});
		}
	};

	const runToolCallStart = async (
		ctx: AgentHookToolCallStartContext,
	): Promise<AgentHookControl | undefined> => {
		const commandPaths = commandMap.tool_call ?? [];
		if (commandPaths.length === 0) {
			return undefined;
		}
		return runBlockingHookCommands({
			commandPaths,
			cwd: options.cwd,
			logger: options.logger,
			timeoutMs: options.toolCallTimeoutMs ?? 120000,
			payload: {
				...createPayloadBase(ctx, options),
				hookName: "tool_call",
				iteration: ctx.iteration,
				tool_call: {
					id: ctx.call.id,
					name: ctx.call.name,
					input: ctx.call.input,
				},
				preToolUse: {
					toolName: ctx.call.name,
					parameters: mapParams(ctx.call.input),
				},
			},
		});
	};

	const runToolCallEnd = async (
		ctx: AgentHookToolCallEndContext,
	): Promise<void> => {
		const commandPaths = commandMap.tool_result ?? [];
		if (commandPaths.length === 0) {
			return;
		}
		runAsyncHookCommands({
			commandPaths,
			cwd: options.cwd,
			logger: options.logger,
			payload: {
				...createPayloadBase(ctx, options),
				hookName: "tool_result",
				iteration: ctx.iteration,
				tool_result: ctx.record,
				postToolUse: {
					toolName: ctx.record.name,
					parameters: mapParams(ctx.record.input),
					result:
						typeof ctx.record.output === "string"
							? ctx.record.output
							: JSON.stringify(ctx.record.output),
					success: !ctx.record.error,
					executionTimeMs: ctx.record.durationMs,
				},
			},
		});
	};

	const runTurnEnd = async (ctx: AgentHookTurnEndContext): Promise<void> => {
		const commandPaths = commandMap.agent_end ?? [];
		if (commandPaths.length === 0) {
			return;
		}
		runAsyncHookCommands({
			commandPaths,
			cwd: options.cwd,
			logger: options.logger,
			payload: {
				...createPayloadBase(ctx, options),
				hookName: "agent_end",
				iteration: ctx.iteration,
				turn: ctx.turn,
				taskComplete: { taskMetadata: {} },
			},
		});
	};

	const runSessionShutdown = async (
		ctx: AgentHookSessionShutdownContext,
	): Promise<void> => {
		if (isAbortReason(ctx.reason)) {
			const abortCommands = commandMap.agent_abort ?? [];
			if (abortCommands.length > 0) {
				runAsyncHookCommands({
					commandPaths: abortCommands,
					cwd: options.cwd,
					logger: options.logger,
					payload: {
						...createPayloadBase(ctx, options),
						hookName: "agent_abort",
						reason: ctx.reason,
						taskCancel: { taskMetadata: {} },
					},
				});
			}
		}
		const shutdownCommands = commandMap.session_shutdown ?? [];
		if (shutdownCommands.length === 0) {
			return;
		}
		runAsyncHookCommands({
			commandPaths: shutdownCommands,
			cwd: options.cwd,
			logger: options.logger,
			payload: {
				...createPayloadBase(ctx, options),
				hookName: "session_shutdown",
				reason: ctx.reason,
			},
		});
	};

	return {
		onRunStart: async (ctx: AgentHookRunStartContext) => {
			await runStartPayload(ctx);
			return undefined;
		},
		onToolCallStart: async (ctx: AgentHookToolCallStartContext) =>
			runToolCallStart(ctx),
		onToolCallEnd: async (ctx: AgentHookToolCallEndContext) => {
			await runToolCallEnd(ctx);
			return undefined;
		},
		onTurnEnd: async (ctx: AgentHookTurnEndContext) => {
			await runTurnEnd(ctx);
			return undefined;
		},
		onSessionShutdown: async (ctx: AgentHookSessionShutdownContext) => {
			await runSessionShutdown(ctx);
			return undefined;
		},
	};
}

function mergeHookFunction<K extends keyof AgentHooks>(
	layers: AgentHooks[],
	key: K,
): AgentHooks[K] | undefined {
	const handlers = layers
		.map((layer) => layer[key])
		.filter((handler) => typeof handler === "function");
	if (handlers.length === 0) {
		return undefined;
	}
	return (async (ctx: unknown) => {
		let control: AgentHookControl | undefined;
		for (const handler of handlers) {
			const next = await (handler as (arg: unknown) => unknown)(ctx);
			control = mergeHookControls(
				control,
				next as AgentHookControl | undefined,
			);
		}
		return control;
	}) as AgentHooks[K];
}

export function mergeAgentHooks(
	layers: Array<AgentHooks | undefined>,
): AgentHooks | undefined {
	const activeLayers = layers.filter(
		(layer): layer is AgentHooks => layer !== undefined,
	);
	if (activeLayers.length === 0) {
		return undefined;
	}

	return {
		onRunStart: mergeHookFunction(activeLayers, "onRunStart"),
		onRunEnd: mergeHookFunction(activeLayers, "onRunEnd"),
		onIterationStart: mergeHookFunction(activeLayers, "onIterationStart"),
		onIterationEnd: mergeHookFunction(activeLayers, "onIterationEnd"),
		onTurnStart: mergeHookFunction(activeLayers, "onTurnStart"),
		onTurnEnd: mergeHookFunction(activeLayers, "onTurnEnd"),
		onToolCallStart: mergeHookFunction(activeLayers, "onToolCallStart"),
		onToolCallEnd: mergeHookFunction(activeLayers, "onToolCallEnd"),
		onSessionShutdown: mergeHookFunction(activeLayers, "onSessionShutdown"),
		onError: mergeHookFunction(activeLayers, "onError"),
	};
}
