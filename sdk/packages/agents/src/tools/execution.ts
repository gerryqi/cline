/**
 * Tool Execution
 *
 * Functions for executing tools with error handling, timeouts, and retries.
 */

import type { Tool, ToolCallRecord, ToolContext } from "@cline/shared";
import type { PendingToolCall } from "../types.js";

export interface ToolExecutionObserver {
	onToolCallStart?: (call: PendingToolCall) => Promise<void> | void;
	onToolCallEnd?: (record: ToolCallRecord) => Promise<void> | void;
}

export interface ToolExecutionAuthorizer {
	authorize?: (
		call: PendingToolCall,
		context: ToolContext,
	) =>
		| Promise<{ allowed: true } | { allowed: false; reason: string }>
		| { allowed: true }
		| { allowed: false; reason: string };
}

export interface ToolExecutionOptions {
	maxConcurrency?: number;
}

/**
 * Execute a single tool with error handling and timeout
 *
 * @param tool - The tool to execute
 * @param input - The input to pass to the tool
 * @param context - The execution context
 * @returns A record of the tool call execution
 */
export async function executeTool(
	tool: Tool,
	input: unknown,
	context: ToolContext,
): Promise<{ output: unknown; error?: string; durationMs: number }> {
	const startTime = Date.now();
	const timeoutMs = tool.timeoutMs ?? 30000;
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	let abortHandler: (() => void) | undefined;

	// Create a timeout promise
	const timeoutPromise = new Promise<never>((_, reject) => {
		timeoutId = setTimeout(() => {
			reject(new Error(`Tool execution timed out after ${timeoutMs}ms`));
		}, timeoutMs);
	});

	// Create abort handling
	const abortPromise = context.abortSignal
		? new Promise<never>((_, reject) => {
				if (context.abortSignal?.aborted) {
					reject(new Error("Tool execution was aborted"));
					return;
				}
				abortHandler = () => {
					reject(new Error("Tool execution was aborted"));
				};
				context.abortSignal?.addEventListener("abort", abortHandler);
			})
		: null;

	try {
		// Execute with timeout and optional abort
		const promises: Promise<unknown>[] = [
			tool.execute(input, context),
			timeoutPromise,
		];
		if (abortPromise) {
			promises.push(abortPromise);
		}

		const output = await Promise.race(promises);
		const durationMs = Date.now() - startTime;

		return { output, durationMs };
	} catch (error) {
		const durationMs = Date.now() - startTime;
		const errorMessage = error instanceof Error ? error.message : String(error);

		return { output: null, error: errorMessage, durationMs };
	} finally {
		if (timeoutId) {
			clearTimeout(timeoutId);
		}
		if (context.abortSignal && abortHandler) {
			context.abortSignal.removeEventListener("abort", abortHandler);
		}
	}
}

/**
 * Execute a tool with retries
 */
export async function executeToolWithRetry(
	tool: Tool,
	input: unknown,
	context: ToolContext,
): Promise<{ output: unknown; error?: string; durationMs: number }> {
	const maxRetries = tool.maxRetries ?? 2;
	let lastResult: {
		output: unknown;
		error?: string;
		durationMs: number;
	} | null = null;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		// Check for abort before each attempt
		if (context.abortSignal?.aborted) {
			return {
				output: null,
				error: "Tool execution was aborted",
				durationMs: lastResult?.durationMs ?? 0,
			};
		}

		const result = await executeTool(tool, input, context);
		lastResult = result;

		// If no error, return immediately
		if (!result.error) {
			return result;
		}

		// If tool is not retryable or we've exhausted retries, return the error
		if (!tool.retryable || attempt === maxRetries) {
			return result;
		}

		// Wait a bit before retrying (exponential backoff)
		const delayMs = Math.min(1000 * 2 ** attempt, 10000);
		await new Promise((resolve) => setTimeout(resolve, delayMs));
	}

	return lastResult!;
}

/**
 * Execute multiple tools in parallel
 *
 * @param toolRegistry - Map of tools by name
 * @param calls - Array of tool calls to execute
 * @param context - The execution context
 * @returns Array of tool call records
 */
export async function executeToolsInParallel(
	toolRegistry: Map<string, Tool>,
	calls: PendingToolCall[],
	context: ToolContext,
	observer?: ToolExecutionObserver,
	authorizer?: ToolExecutionAuthorizer,
	options?: ToolExecutionOptions,
): Promise<ToolCallRecord[]> {
	const executeCall = async (
		call: PendingToolCall,
	): Promise<ToolCallRecord> => {
		const startedAt = new Date();
		await observer?.onToolCallStart?.(call);
		const tool = toolRegistry.get(call.name);

		if (!tool) {
			const endedAt = new Date();
			const record = {
				id: call.id,
				name: call.name,
				input: call.input,
				output: null,
				error: `Unknown tool: ${call.name}`,
				durationMs: endedAt.getTime() - startedAt.getTime(),
				startedAt,
				endedAt,
			};
			await observer?.onToolCallEnd?.(record);
			return record;
		}

		const authorization = await authorizer?.authorize?.(call, context);
		if (authorization && !authorization.allowed) {
			const endedAt = new Date();
			const record = {
				id: call.id,
				name: call.name,
				input: call.input,
				output: null,
				error: authorization.reason,
				durationMs: endedAt.getTime() - startedAt.getTime(),
				startedAt,
				endedAt,
			};
			await observer?.onToolCallEnd?.(record);
			return record;
		}

		const result = await executeToolWithRetry(tool, call.input, context);
		const endedAt = new Date();

		const record = {
			id: call.id,
			name: call.name,
			input: call.input,
			output: result.output,
			error: result.error,
			durationMs: result.durationMs,
			startedAt,
			endedAt,
		};
		await observer?.onToolCallEnd?.(record);
		return record;
	};

	const maxConcurrency = Math.max(
		1,
		options?.maxConcurrency ?? (calls.length || 1),
	);
	const results = new Array<ToolCallRecord>(calls.length);
	let nextIndex = 0;
	const workerCount = Math.min(maxConcurrency, calls.length);
	const workers = Array.from({ length: workerCount }, async () => {
		while (true) {
			const index = nextIndex++;
			if (index >= calls.length) {
				return;
			}
			results[index] = await executeCall(calls[index]);
		}
	});
	await Promise.all(workers);
	return results;
}

/**
 * Execute tools sequentially (for cases where order matters)
 */
export async function executeToolsSequentially(
	toolRegistry: Map<string, Tool>,
	calls: PendingToolCall[],
	context: ToolContext,
	observer?: ToolExecutionObserver,
	authorizer?: ToolExecutionAuthorizer,
): Promise<ToolCallRecord[]> {
	const results: ToolCallRecord[] = [];

	for (const call of calls) {
		// Check for abort before each tool
		if (context.abortSignal?.aborted) {
			break;
		}

		const startedAt = new Date();
		await observer?.onToolCallStart?.(call);
		const tool = toolRegistry.get(call.name);

		if (!tool) {
			const endedAt = new Date();
			const record = {
				id: call.id,
				name: call.name,
				input: call.input,
				output: null,
				error: `Unknown tool: ${call.name}`,
				durationMs: endedAt.getTime() - startedAt.getTime(),
				startedAt,
				endedAt,
			};
			await observer?.onToolCallEnd?.(record);
			results.push(record);
			continue;
		}

		const authorization = await authorizer?.authorize?.(call, context);
		if (authorization && !authorization.allowed) {
			const endedAt = new Date();
			const record = {
				id: call.id,
				name: call.name,
				input: call.input,
				output: null,
				error: authorization.reason,
				durationMs: endedAt.getTime() - startedAt.getTime(),
				startedAt,
				endedAt,
			};
			await observer?.onToolCallEnd?.(record);
			results.push(record);
			continue;
		}

		const result = await executeToolWithRetry(tool, call.input, context);
		const endedAt = new Date();

		const record = {
			id: call.id,
			name: call.name,
			input: call.input,
			output: result.output,
			error: result.error,
			durationMs: result.durationMs,
			startedAt,
			endedAt,
		};
		await observer?.onToolCallEnd?.(record);
		results.push(record);
	}

	return results;
}
