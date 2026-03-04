/**
 * Tool Call Processor
 *
 * Handles incremental assembly of tool calls from streaming responses.
 * Tool calls can arrive in chunks that need to be accumulated.
 */

import type {
	ApiStreamToolCall,
	ApiStreamToolCallsChunk,
} from "../types/stream";

// Re-export to satisfy linter (type is used in generator return type)
export type { ApiStreamToolCallsChunk };

interface ToolCallDelta {
	index: number;
	id?: string;
	function?: {
		name?: string;
		arguments?: string;
	};
}

/**
 * Processes tool call deltas from streaming API responses
 */
export class ToolCallProcessor {
	private toolCalls: Map<
		number,
		{
			id: string;
			name: string;
			arguments: string;
		}
	> = new Map();

	/**
	 * Process tool call deltas and yield complete tool calls
	 */
	processToolCallDeltas(
		deltas: ToolCallDelta[],
		responseId: string,
	): ApiStreamToolCallsChunk[] {
		const results: ApiStreamToolCallsChunk[] = [];
		for (const delta of deltas) {
			const { index, id } = delta;
			const fn = delta.function;

			// Get or create tool call state
			let toolCall = this.toolCalls.get(index);
			if (!toolCall) {
				toolCall = { id: "", name: "", arguments: "" };
				this.toolCalls.set(index, toolCall);
			}

			// Update with delta values
			if (id) {
				toolCall.id = id;
			}
			if (fn?.name) {
				toolCall.name = fn.name;
			}
			const deltaArguments = fn?.arguments ?? "";
			if (deltaArguments) {
				toolCall.arguments += deltaArguments;
			}

			// Add the current state as a chunk
			// This allows streaming of partial tool calls
			if (toolCall.id && toolCall.name) {
				results.push({
					type: "tool_calls",
					id: responseId,
					tool_call: {
						call_id: toolCall.id,
						function: {
							id: toolCall.id,
							name: toolCall.name,
							// Emit only the current delta arguments; the agent layer already
							// performs accumulation for streaming tool arguments.
							arguments: deltaArguments,
						},
					},
				});
			}
		}
		return results;
	}

	/**
	 * Get all accumulated tool calls
	 */
	getToolCalls(): ApiStreamToolCall[] {
		return Array.from(this.toolCalls.values()).map((tc) => ({
			call_id: tc.id,
			function: {
				id: tc.id,
				name: tc.name,
				arguments: tc.arguments,
			},
		}));
	}

	/**
	 * Reset the processor state
	 */
	reset(): void {
		this.toolCalls.clear();
	}
}
