/**
 * Stream Response Processor
 *
 * Processes ApiStreamChunks and assembles them into Cline's message content format.
 * This provides a clean interface between the streaming API and Cline's storage format.
 */

import { JSONParser } from "@streamparser/json";
import type {
	ApiStreamChunk,
	ApiStreamReasoningChunk,
	ApiStreamTextChunk,
	ApiStreamToolCallsChunk,
	ApiStreamUsageChunk,
} from "../types/stream";

// ============================================================================
// Output Types (Cline Storage Format)
// ============================================================================

export interface ReasoningDetailParam {
	type: "reasoning.text" | string;
	text: string;
	signature: string;
	format: "anthropic-claude-v1" | string;
	index: number;
}

export interface AssistantTextBlock {
	type: "text";
	text: string;
	call_id?: string;
	reasoning_details?: ReasoningDetailParam[];
	signature?: string;
}

export interface AssistantToolUseBlock {
	type: "tool_use";
	id: string;
	name: string;
	input: Record<string, unknown>;
	call_id?: string;
	reasoning_details?: ReasoningDetailParam[];
	signature?: string;
}

export interface AssistantThinkingBlock {
	type: "thinking";
	thinking: string;
	signature: string;
	call_id?: string;
	summary?: ReasoningDetailParam[];
}

export interface AssistantRedactedThinkingBlock {
	type: "redacted_thinking";
	data: string;
	call_id?: string;
}

export type AssistantContentBlock =
	| AssistantTextBlock
	| AssistantToolUseBlock
	| AssistantThinkingBlock
	| AssistantRedactedThinkingBlock;

export interface UsageInfo {
	inputTokens: number;
	outputTokens: number;
	cacheWriteTokens?: number;
	cacheReadTokens?: number;
	thoughtsTokenCount?: number;
	totalCost?: number;
}

export interface ProcessedResponse {
	content: AssistantContentBlock[];
	usage?: UsageInfo;
	responseId?: string;
	incompleteReason?: string;
}

// ============================================================================
// Internal State
// ============================================================================

interface PendingToolUse {
	id: string;
	name: string;
	rawInput: string;
	parsedInput?: Record<string, unknown>;
	signature?: string;
	callId: string;
	parser: JSONParser;
}

interface PendingReasoning {
	thinking: string;
	signature: string;
	details: ReasoningDetailParam[];
	redactedBlocks: AssistantRedactedThinkingBlock[];
	callId?: string;
}

// ============================================================================
// Stream Response Processor
// ============================================================================

/**
 * Processes streaming API responses and assembles content blocks.
 *
 * Usage:
 * ```ts
 * const processor = new StreamResponseProcessor()
 * for await (const chunk of apiStream) {
 *   const partial = processor.process(chunk)
 *   // Use partial for live updates
 * }
 * const final = processor.finalize()
 * ```
 */
export class StreamResponseProcessor {
	private text = "";
	private textSignature?: string;
	private toolUses = new Map<string, PendingToolUse>();
	private reasoning: PendingReasoning | null = null;
	private usage: UsageInfo | null = null;
	private responseId?: string;
	private incompleteReason?: string;

	/**
	 * Process a single stream chunk and return current partial state.
	 * Call this for each chunk to get live updates.
	 */
	process(chunk: ApiStreamChunk): ProcessedResponse {
		switch (chunk.type) {
			case "text":
				this.processText(chunk);
				break;
			case "reasoning":
				this.processReasoning(chunk);
				break;
			case "tool_calls":
				this.processToolCall(chunk);
				break;
			case "usage":
				this.processUsage(chunk);
				break;
			case "done":
				this.incompleteReason = chunk.incompleteReason;
				if (chunk.id) this.responseId = chunk.id;
				break;
		}

		return this.getPartialResponse();
	}

	/**
	 * Finalize and return the complete response.
	 * Call this after all chunks have been processed.
	 */
	finalize(): ProcessedResponse {
		const content: AssistantContentBlock[] = [];

		// Add thinking block if present
		if (
			this.reasoning &&
			(this.reasoning.thinking || this.reasoning.details.length)
		) {
			content.push({
				type: "thinking",
				thinking: this.reasoning.thinking,
				signature: this.reasoning.signature,
				call_id: this.reasoning.callId,
				summary: this.reasoning.details.length
					? this.reasoning.details
					: undefined,
			});

			// Add any redacted thinking blocks
			content.push(...this.reasoning.redactedBlocks);
		}

		// Add text if present
		if (this.text) {
			content.push({
				type: "text",
				text: this.text,
				signature: this.textSignature,
				reasoning_details: this.reasoning?.details.length
					? this.reasoning.details
					: undefined,
			});
		}

		// Add finalized tool uses
		for (const pending of this.toolUses.values()) {
			if (!pending.name) continue;

			const input = this.finalizeToolInput(pending);
			content.push({
				type: "tool_use",
				id: pending.id,
				name: pending.name,
				input,
				call_id: pending.callId,
				signature: pending.signature,
				reasoning_details: this.reasoning?.details.length
					? this.reasoning.details
					: undefined,
			});
		}

		return {
			content,
			usage: this.usage ?? undefined,
			responseId: this.responseId,
			incompleteReason: this.incompleteReason,
		};
	}

	/**
	 * Get current partial response for live streaming updates.
	 */
	getPartialResponse(): ProcessedResponse {
		const content: AssistantContentBlock[] = [];

		// Add partial thinking
		if (
			this.reasoning &&
			(this.reasoning.thinking || this.reasoning.details.length)
		) {
			content.push({
				type: "thinking",
				thinking: this.reasoning.thinking,
				signature: this.reasoning.signature,
				call_id: this.reasoning.callId,
				summary: this.reasoning.details.length
					? this.reasoning.details
					: undefined,
			});
		}

		// Add partial text
		if (this.text) {
			content.push({
				type: "text",
				text: this.text,
				signature: this.textSignature,
			});
		}

		// Add partial tool uses
		for (const pending of this.toolUses.values()) {
			if (!pending.name) continue;

			const input =
				pending.parsedInput ?? this.extractPartialJson(pending.rawInput);
			content.push({
				type: "tool_use",
				id: pending.id,
				name: pending.name,
				input,
				call_id: pending.callId,
				signature: pending.signature,
			});
		}

		return {
			content,
			usage: this.usage ?? undefined,
			responseId: this.responseId,
		};
	}

	/**
	 * Reset processor state for reuse.
	 */
	reset(): void {
		this.text = "";
		this.textSignature = undefined;
		this.toolUses.clear();
		this.reasoning = null;
		this.usage = null;
		this.responseId = undefined;
		this.incompleteReason = undefined;
	}

	// ============================================================================
	// Private Methods
	// ============================================================================

	private processText(chunk: ApiStreamTextChunk): void {
		this.text += chunk.text;
		if (chunk.signature) this.textSignature = chunk.signature;
		if (chunk.id) this.responseId = chunk.id;
	}

	private processReasoning(chunk: ApiStreamReasoningChunk): void {
		if (!this.reasoning) {
			this.reasoning = {
				thinking: "",
				signature: "",
				details: [],
				redactedBlocks: [],
				callId: chunk.id,
			};
		}

		if (chunk.reasoning) {
			this.reasoning.thinking += chunk.reasoning;
		}

		if (chunk.signature) {
			this.reasoning.signature = chunk.signature;
		}

		if (chunk.details) {
			const details = Array.isArray(chunk.details)
				? chunk.details
				: [chunk.details];
			for (const detail of details) {
				if (this.isReasoningDetail(detail)) {
					this.reasoning.details.push(detail);
					// Extract signature from details if not set at top level
					if (!this.reasoning.signature && detail.signature) {
						this.reasoning.signature = detail.signature;
					}
				}
			}
		}

		if (chunk.redacted_data) {
			this.reasoning.redactedBlocks.push({
				type: "redacted_thinking",
				data: chunk.redacted_data,
				call_id: chunk.id ?? this.reasoning.callId,
			});
		}

		if (chunk.id) this.responseId = chunk.id;
	}

	private processToolCall(chunk: ApiStreamToolCallsChunk): void {
		const tc = chunk.tool_call;
		const fn = tc.function;
		const id = fn.id ?? tc.call_id ?? "";

		if (!id) return;

		let pending = this.toolUses.get(id);
		if (!pending) {
			pending = this.createPendingToolUse(id, tc.call_id ?? id);
			this.toolUses.set(id, pending);
		}

		if (fn.name) {
			pending.name = fn.name;
		}

		if (chunk.signature) {
			pending.signature = chunk.signature;
		}

		if (fn.arguments) {
			const args =
				typeof fn.arguments === "string"
					? fn.arguments
					: JSON.stringify(fn.arguments);
			pending.rawInput += args;
			try {
				pending.parser.write(args);
			} catch {
				// Expected during streaming - parser may not have complete JSON
			}
		}

		if (chunk.id) this.responseId = chunk.id;
	}

	private processUsage(chunk: ApiStreamUsageChunk): void {
		this.usage = {
			inputTokens: chunk.inputTokens,
			outputTokens: chunk.outputTokens,
			cacheWriteTokens: chunk.cacheWriteTokens,
			cacheReadTokens: chunk.cacheReadTokens,
			thoughtsTokenCount: chunk.thoughtsTokenCount,
			totalCost: chunk.totalCost,
		};
		if (chunk.id) this.responseId = chunk.id;
	}

	private createPendingToolUse(id: string, callId: string): PendingToolUse {
		const pending: PendingToolUse = {
			id,
			name: "",
			rawInput: "",
			parsedInput: undefined,
			signature: undefined,
			callId,
			parser: new JSONParser(),
		};

		pending.parser.onValue = (info: { stack: unknown[]; value?: unknown }) => {
			if (
				info.stack.length === 0 &&
				info.value &&
				typeof info.value === "object"
			) {
				pending.parsedInput = info.value as Record<string, unknown>;
			}
		};
		pending.parser.onError = () => {};

		return pending;
	}

	private finalizeToolInput(pending: PendingToolUse): Record<string, unknown> {
		if (pending.parsedInput) {
			return pending.parsedInput;
		}

		if (pending.rawInput) {
			try {
				return JSON.parse(pending.rawInput);
			} catch {
				return this.extractPartialJson(pending.rawInput);
			}
		}

		return {};
	}

	/**
	 * Extract fields from incomplete JSON during streaming.
	 */
	private extractPartialJson(partial: string): Record<string, unknown> {
		const result: Record<string, unknown> = {};
		const pattern = /"(\w+)":\s*"((?:[^"\\]|\\.)*)(?:")?/g;

		for (const match of partial.matchAll(pattern)) {
			result[match[1]] = this.unescapeString(match[2]);
		}

		return result;
	}

	private unescapeString(str: string): string {
		return str
			.replace(/\\n/g, "\n")
			.replace(/\\t/g, "\t")
			.replace(/\\r/g, "\r")
			.replace(/\\"/g, '"')
			.replace(/\\\\/g, "\\");
	}

	private isReasoningDetail(value: unknown): value is ReasoningDetailParam {
		return (
			typeof value === "object" &&
			value !== null &&
			"type" in value &&
			"text" in value &&
			typeof (value as ReasoningDetailParam).text === "string"
		);
	}
}
