import { spawn } from "node:child_process";
import type {
	HookSessionContext,
	HookSessionContextProvider,
} from "@cline/shared";
import { resolveHookSessionContext } from "@cline/shared";
import { z } from "zod";
import type {
	AgentHookControl,
	AgentHookRunStartContext,
	AgentHookSessionShutdownContext,
	AgentHooks,
	AgentHookToolCallEndContext,
	AgentHookToolCallStartContext,
	AgentHookTurnEndContext,
	ToolCallRecord,
} from "../types.js";

export const HookEventNameSchema = z.enum([
	"agent_start",
	"agent_resume",
	"agent_abort",
	"agent_end",
	"tool_call",
	"tool_result",
	"prompt_submit",
	"pre_compact",
	"session_shutdown",
]);

export type HookEventName = z.infer<typeof HookEventNameSchema>;

const StringMapSchema = z.record(z.string(), z.string());

export interface HookOutput {
	contextModification: string;
	cancel: boolean;
	errorMessage: string;
}

export const HookOutputSchema = z
	.object({
		contextModification: z.string().optional(),
		cancel: z.boolean().optional(),
		errorMessage: z.string().optional(),
		context: z.string().optional(),
		overrideInput: z.unknown().optional(),
	})
	.passthrough();

export interface PreToolUseData {
	toolName: string;
	parameters: Record<string, string>;
}

export interface PostToolUseData {
	toolName: string;
	parameters: Record<string, string>;
	result: string;
	success: boolean;
	executionTimeMs: number;
}

export interface UserPromptSubmitData {
	prompt: string;
	attachments: string[];
}

export interface TaskStartData {
	taskMetadata: Record<string, string>;
}

export interface TaskResumeData {
	taskMetadata: Record<string, string>;
	previousState: Record<string, string>;
}

export interface TaskCancelData {
	taskMetadata: Record<string, string>;
}

export interface TaskCompleteData {
	taskMetadata: Record<string, string>;
}

export interface PreCompactData {
	taskId: string;
	ulid: string;
	contextSize: number;
	compactionStrategy: string;
	previousApiReqIndex: number;
	tokensIn: number;
	tokensOut: number;
	tokensInCache: number;
	tokensOutCache: number;
	deletedRangeStart: number;
	deletedRangeEnd: number;
	contextJsonPath: string;
	contextRawPath: string;
}

const PreToolUseDataSchema = z.object({
	toolName: z.string(),
	parameters: StringMapSchema,
});

const PostToolUseDataSchema = z.object({
	toolName: z.string(),
	parameters: StringMapSchema,
	result: z.string(),
	success: z.boolean(),
	executionTimeMs: z.number(),
});

const UserPromptSubmitDataSchema = z.object({
	prompt: z.string(),
	attachments: z.array(z.string()),
});

const TaskStartDataSchema = z.object({ taskMetadata: StringMapSchema });
const TaskResumeDataSchema = z.object({
	taskMetadata: StringMapSchema,
	previousState: StringMapSchema,
});
const TaskCancelDataSchema = z.object({ taskMetadata: StringMapSchema });
const TaskCompleteDataSchema = z.object({ taskMetadata: StringMapSchema });

const PreCompactDataSchema = z.object({
	taskId: z.string(),
	ulid: z.string(),
	contextSize: z.number(),
	compactionStrategy: z.string(),
	previousApiReqIndex: z.number(),
	tokensIn: z.number(),
	tokensOut: z.number(),
	tokensInCache: z.number(),
	tokensOutCache: z.number(),
	deletedRangeStart: z.number(),
	deletedRangeEnd: z.number(),
	contextJsonPath: z.string(),
	contextRawPath: z.string(),
});

export interface HookEventPayloadBase {
	clineVersion: string;
	hookName: HookEventName;
	timestamp: string;
	taskId: string;
	sessionContext?: HookSessionContext;
	workspaceRoots: string[];
	userId: string;
	agent_id: string;
	parent_agent_id: string | null;
	preToolUse?: PreToolUseData | undefined;
	postToolUse?: PostToolUseData | undefined;
	userPromptSubmit?: UserPromptSubmitData | undefined;
	taskStart?: TaskStartData | undefined;
	taskResume?: TaskResumeData | undefined;
	taskCancel?: TaskCancelData | undefined;
	taskComplete?: TaskCompleteData | undefined;
	preCompact?: PreCompactData | undefined;
}

export interface ToolCallHookPayload extends HookEventPayloadBase {
	hookName: "tool_call";
	iteration: number;
	tool_call: {
		id: string;
		name: string;
		input: unknown;
	};
}

export interface ToolResultHookPayload extends HookEventPayloadBase {
	hookName: "tool_result";
	iteration: number;
	tool_result: ToolCallRecord;
}

export interface AgentEndHookPayload extends HookEventPayloadBase {
	hookName: "agent_end";
	iteration: number;
	turn: AgentHookTurnEndContext["turn"];
}

export interface AgentStartHookPayload extends HookEventPayloadBase {
	hookName: "agent_start";
}

export interface AgentResumeHookPayload extends HookEventPayloadBase {
	hookName: "agent_resume";
}

export interface AgentAbortHookPayload extends HookEventPayloadBase {
	hookName: "agent_abort";
	reason?: string;
}

export interface PromptSubmitHookPayload extends HookEventPayloadBase {
	hookName: "prompt_submit";
}

export interface PreCompactHookPayload extends HookEventPayloadBase {
	hookName: "pre_compact";
	preCompact: PreCompactData;
}

export interface SessionShutdownHookPayload extends HookEventPayloadBase {
	hookName: "session_shutdown";
	reason?: string;
}

export type HookEventPayload =
	| ToolCallHookPayload
	| ToolResultHookPayload
	| AgentStartHookPayload
	| AgentResumeHookPayload
	| AgentAbortHookPayload
	| PromptSubmitHookPayload
	| PreCompactHookPayload
	| AgentEndHookPayload
	| SessionShutdownHookPayload;

export const HookEventPayloadSchema = z
	.object({
		clineVersion: z.string(),
		hookName: HookEventNameSchema,
		timestamp: z.string(),
		taskId: z.string(),
		sessionContext: z
			.object({
				rootSessionId: z.string().optional(),
				hookLogPath: z.string().optional(),
			})
			.optional(),
		workspaceRoots: z.array(z.string()),
		userId: z.string(),
		agent_id: z.string(),
		parent_agent_id: z.string().nullable(),
		iteration: z.number().optional(),
		reason: z.string().optional(),
		tool_call: z
			.object({
				id: z.string(),
				name: z.string(),
				input: z.unknown(),
			})
			.optional(),
		tool_result: z.custom<ToolCallRecord>().optional(),
		turn: z.custom<AgentHookTurnEndContext["turn"]>().optional(),
		preToolUse: PreToolUseDataSchema.optional(),
		postToolUse: PostToolUseDataSchema.optional(),
		userPromptSubmit: UserPromptSubmitDataSchema.optional(),
		taskStart: TaskStartDataSchema.optional(),
		taskResume: TaskResumeDataSchema.optional(),
		taskCancel: TaskCancelDataSchema.optional(),
		taskComplete: TaskCompleteDataSchema.optional(),
		preCompact: PreCompactDataSchema.optional(),
	})
	.passthrough();

export function parseHookEventPayload(
	value: unknown,
): HookEventPayload | undefined {
	const parsed = HookEventPayloadSchema.safeParse(value);
	if (!parsed.success) {
		return undefined;
	}
	return parsed.data as HookEventPayload;
}

export interface RunHookOptions {
	command?: string[];
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	detached?: boolean;
	timeoutMs?: number;
}

export interface RunHookResult {
	exitCode: number | null;
	stdout: string;
	stderr: string;
	parsedJson?: unknown;
	parseError?: string;
	timedOut?: boolean;
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
	let timedOut = false;
	let timeoutId: NodeJS.Timeout | undefined;
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
		if ((options.timeoutMs ?? 0) > 0) {
			timeoutId = setTimeout(() => {
				timedOut = true;
				child.kill("SIGKILL");
			}, options.timeoutMs);
		}
		child.once("close", (exitCode) => {
			if (timeoutId) {
				clearTimeout(timeoutId);
			}
			const { parsedJson, parseError } = parseHookStdout(stdout);
			resolve({
				exitCode,
				stdout,
				stderr,
				parsedJson,
				parseError,
				timedOut,
			});
		});
	});
}

function parseHookStdout(stdout: string): {
	parsedJson?: unknown;
	parseError?: string;
} {
	const trimmed = stdout.trim();
	if (!trimmed) {
		return {};
	}

	const lines = trimmed
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	const prefixed = lines
		.filter((line) => line.startsWith("HOOK_CONTROL\t"))
		.map((line) => line.slice("HOOK_CONTROL\t".length));

	const candidate =
		prefixed.length > 0 ? prefixed[prefixed.length - 1] : trimmed;
	try {
		return { parsedJson: JSON.parse(candidate) };
	} catch (error) {
		return {
			parseError:
				error instanceof Error
					? error.message
					: "Failed to parse hook stdout JSON",
		};
	}
}

export interface SubprocessHooksOptions {
	command?: string[];
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	/**
	 * Timeout in milliseconds for blocking tool_call hook invocation.
	 */
	timeoutMs?: number;
	/**
	 * Optional callback for non-fatal hook dispatch errors.
	 */
	onDispatchError?: (error: Error, payload: HookEventPayload) => void;
	/**
	 * Optional callback invoked after a hook dispatch is attempted.
	 */
	onDispatch?: (event: {
		payload: HookEventPayload;
		result?: RunHookResult;
		detached: boolean;
	}) => void;
	/**
	 * Optional context attached to every hook payload.
	 * Use this to scope hook events to a root runtime session without global env state.
	 */
	sessionContext?: HookSessionContextProvider;
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
	const parsed = HookOutputSchema.safeParse(value);
	if (!parsed.success) {
		return undefined;
	}
	const maybe = parsed.data;
	const hasControlKey =
		"cancel" in maybe ||
		"context" in maybe ||
		"contextModification" in maybe ||
		"overrideInput" in maybe ||
		"errorMessage" in maybe;
	if (!hasControlKey) {
		return undefined;
	}
	const contextFromHook =
		typeof maybe.context === "string"
			? maybe.context
			: typeof maybe.contextModification === "string"
				? maybe.contextModification
				: typeof maybe.errorMessage === "string" &&
						maybe.errorMessage.length > 0
					? maybe.errorMessage
					: undefined;
	return {
		cancel: typeof maybe.cancel === "boolean" ? maybe.cancel : undefined,
		context: contextFromHook,
		overrideInput: Object.hasOwn(maybe, "overrideInput")
			? maybe.overrideInput
			: undefined,
	};
}

function mapParams(input: unknown): Record<string, string> {
	if (!input || typeof input !== "object") {
		return {};
	}
	const output: Record<string, string> = {};
	for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
		if (typeof value === "string") {
			output[key] = value;
		} else {
			output[key] = JSON.stringify(value);
		}
	}
	return output;
}

function basePayload(
	hookName: HookEventName,
	ctx: {
		agentId: string;
		conversationId: string;
		parentAgentId: string | null;
	},
	options: SubprocessHooksOptions,
): HookEventPayloadBase {
	const env = options.env ?? process.env;
	const userId = env.CLINE_USER_ID?.trim() || env.USER?.trim() || "unknown";
	const workspaceRoot = options.cwd || process.cwd();
	return {
		clineVersion: env.CLINE_VERSION?.trim() || "",
		hookName,
		timestamp: new Date().toISOString(),
		taskId: ctx.conversationId,
		sessionContext: resolveHookSessionContext(options.sessionContext),
		workspaceRoots: workspaceRoot ? [workspaceRoot] : [],
		userId,
		agent_id: ctx.agentId,
		parent_agent_id: ctx.parentAgentId,
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

async function dispatchDetached(
	payload: HookEventPayload,
	options: SubprocessHooksOptions,
): Promise<void> {
	try {
		const result = await runHook(payload, {
			command: options.command,
			cwd: options.cwd,
			env: options.env,
			detached: true,
		});
		options.onDispatch?.({ payload, result, detached: true });
	} catch (error) {
		options.onDispatchError?.(toError(error), payload);
	}
}

/**
 * Create lifecycle hooks that mirror Pi-style hook events:
 * - tool_call (blocking)
 * - tool_result (fire-and-forget)
 * - agent_start (fire-and-forget)
 * - prompt_submit (fire-and-forget)
 * - agent_end (fire-and-forget)
 * - session_shutdown (fire-and-forget via returned `shutdown()`)
 */
export function createSubprocessHooks(
	options: SubprocessHooksOptions = {},
): SubprocessHookControl {
	const onRunStart = async (
		ctx: AgentHookRunStartContext,
	): Promise<AgentHookControl | undefined> => {
		const isResume =
			(options.env ?? process.env).CLINE_HOOK_AGENT_RESUME === "1";
		if (isResume) {
			const resumePayload: AgentResumeHookPayload = {
				...basePayload("agent_resume", ctx, options),
				hookName: "agent_resume",
				taskResume: {
					taskMetadata: {},
					previousState: {},
				},
			};
			await dispatchDetached(resumePayload, options);
		} else {
			const startPayload: AgentStartHookPayload = {
				...basePayload("agent_start", ctx, options),
				hookName: "agent_start",
				taskStart: { taskMetadata: {} },
			};
			await dispatchDetached(startPayload, options);
		}

		const promptPayload: PromptSubmitHookPayload = {
			...basePayload("prompt_submit", ctx, options),
			hookName: "prompt_submit",
			userPromptSubmit: {
				prompt: ctx.userMessage,
				attachments: [],
			},
		};
		await dispatchDetached(promptPayload, options);
		return undefined;
	};

	const onToolCallStart = async (
		ctx: AgentHookToolCallStartContext,
	): Promise<AgentHookControl | undefined> => {
		const payload: ToolCallHookPayload = {
			...basePayload("tool_call", ctx, options),
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
		};

		try {
			const result = await runHook(payload, {
				command: options.command,
				cwd: options.cwd,
				env: options.env,
				detached: false,
				timeoutMs: options.timeoutMs,
			});
			options.onDispatch?.({ payload, result, detached: false });
			if (result?.timedOut) {
				throw new Error("tool_call hook command timed out");
			}
			if (result?.parseError) {
				throw new Error(
					`tool_call hook produced invalid control JSON: ${result.parseError}`,
				);
			}
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
			...basePayload("tool_result", ctx, options),
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
		};
		await dispatchDetached(payload, options);
		return undefined;
	};

	const onTurnEnd = async (
		ctx: AgentHookTurnEndContext,
	): Promise<AgentHookControl | undefined> => {
		const payload: AgentEndHookPayload = {
			...basePayload("agent_end", ctx, options),
			hookName: "agent_end",
			iteration: ctx.iteration,
			turn: ctx.turn,
			taskComplete: { taskMetadata: {} },
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
		if (isAbortReason(ctx.reason)) {
			const abortPayload: AgentAbortHookPayload = {
				...basePayload("agent_abort", ctx, options),
				hookName: "agent_abort",
				reason: ctx.reason,
				taskCancel: { taskMetadata: {} },
			};
			await dispatchDetached(abortPayload, options);
		}
		const payload: SessionShutdownHookPayload = {
			...basePayload("session_shutdown", ctx, options),
			hookName: "session_shutdown",
			reason: ctx.reason,
		};
		await dispatchDetached(payload, options);
	};

	return {
		hooks: {
			onRunStart,
			onToolCallStart,
			onToolCallEnd,
			onTurnEnd,
			onSessionShutdown: async ({
				agentId,
				conversationId,
				parentAgentId,
				reason,
			}: AgentHookSessionShutdownContext) => {
				await shutdown({ agentId, conversationId, parentAgentId, reason });
				return undefined;
			},
		},
		shutdown,
	};
}
