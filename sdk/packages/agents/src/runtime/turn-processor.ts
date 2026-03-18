import type { providers } from "@clinebot/llms";
import { parseJsonStream } from "@clinebot/shared";
import type { MessageBuilder } from "../message-builder.js";
import { toToolDefinitions } from "../tools/index.js";
import type {
	AgentEvent,
	PendingToolCall,
	ProcessedTurn,
	Tool,
} from "../types.js";

export interface TurnProcessorOptions {
	handler: providers.ApiHandler;
	messageBuilder: MessageBuilder;
	emit: (event: AgentEvent) => void;
}

export class TurnProcessor {
	private readonly handler: providers.ApiHandler;
	private readonly messageBuilder: MessageBuilder;
	private readonly emit: (event: AgentEvent) => void;

	constructor(options: TurnProcessorOptions) {
		this.handler = options.handler;
		this.messageBuilder = options.messageBuilder;
		this.emit = options.emit;
	}

	async processTurn(
		messages: providers.Message[],
		systemPrompt: string,
		tools: Tool[],
		abortSignal: AbortSignal,
	): Promise<{ turn: ProcessedTurn; assistantMessage?: providers.Message }> {
		const toolDefinitions = toToolDefinitions(tools);
		const requestMessages = this.messageBuilder.buildForApi(messages);
		const stream = this.handler.createMessage(
			systemPrompt,
			requestMessages,
			toolDefinitions,
		);

		let text = "";
		let textSignature: string | undefined;
		let reasoning = "";
		let reasoningSignature: string | undefined;
		const redactedReasoningBlocks: string[] = [];
		const usage = {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: undefined as number | undefined,
			cacheWriteTokens: undefined as number | undefined,
			cost: undefined as number | undefined,
		};
		let truncated = false;
		let responseId: string | undefined;

		const pendingToolCallsMap = new Map<
			string,
			{ name?: string; arguments: string; signature?: string }
		>();

		for await (const chunk of stream) {
			if (abortSignal.aborted) {
				break;
			}

			responseId = chunk.id ?? responseId;

			switch (chunk.type) {
				case "text":
					text += chunk.text;
					if (chunk.signature) {
						textSignature = chunk.signature;
					}
					this.emit({
						type: "content_start",
						contentType: "text",
						text: chunk.text,
						accumulated: text,
					});
					break;
				case "reasoning":
					reasoning += chunk.reasoning;
					if (chunk.signature) {
						reasoningSignature = chunk.signature;
					}
					if (chunk.redacted_data) {
						redactedReasoningBlocks.push(chunk.redacted_data);
					}
					this.emit({
						type: "content_start",
						contentType: "reasoning",
						reasoning: chunk.reasoning,
						redacted: !!chunk.redacted_data,
					});
					break;
				case "tool_calls":
					this.processToolCallChunk(chunk, pendingToolCallsMap);
					break;
				case "usage":
					usage.inputTokens = chunk.inputTokens;
					usage.outputTokens = chunk.outputTokens;
					usage.cacheReadTokens = chunk.cacheReadTokens;
					usage.cacheWriteTokens = chunk.cacheWriteTokens;
					usage.cost = chunk.totalCost;
					break;
				case "done":
					truncated = chunk.incompleteReason === "max_tokens";
					if (!chunk.success && chunk.error) {
						throw new Error(chunk.error);
					}
					break;
			}
		}

		const toolCalls = this.finalizePendingToolCalls(pendingToolCallsMap);
		const assistantContent: providers.ContentBlock[] = [];

		if (text) {
			this.emit({
				type: "content_end",
				contentType: "text",
				text,
			});
		}
		if (reasoning || redactedReasoningBlocks.length > 0) {
			this.emit({
				type: "content_end",
				contentType: "reasoning",
				reasoning,
			});
			assistantContent.push({
				type: "thinking",
				thinking: reasoning,
				signature: reasoningSignature,
			});
			for (const redactedData of redactedReasoningBlocks) {
				assistantContent.push({
					type: "redacted_thinking",
					data: redactedData,
				});
			}
		}
		if (text) {
			assistantContent.push({ type: "text", text, signature: textSignature });
		}
		for (const call of toolCalls) {
			assistantContent.push({
				type: "tool_use",
				id: call.id,
				name: call.name,
				input: call.input as Record<string, unknown>,
				signature: call.signature,
			});
		}

		const assistantMessage =
			assistantContent.length > 0
				? {
						role: "assistant" as const,
						content: assistantContent,
					}
				: undefined;

		return {
			turn: {
				text,
				reasoning: reasoning || undefined,
				toolCalls,
				usage,
				truncated,
				responseId,
			},
			assistantMessage,
		};
	}

	private processToolCallChunk(
		chunk: providers.ApiStreamChunk & { type: "tool_calls" },
		pendingMap: Map<
			string,
			{ name?: string; arguments: string; signature?: string }
		>,
	): void {
		const { tool_call } = chunk;
		const callId =
			tool_call.call_id ?? tool_call.function.id ?? `call_${Date.now()}`;

		let pending = pendingMap.get(callId);
		if (!pending) {
			pending = { name: undefined, arguments: "" };
			pendingMap.set(callId, pending);
		}

		if (tool_call.function.name) {
			pending.name = tool_call.function.name;
		}

		if (tool_call.function.arguments) {
			if (typeof tool_call.function.arguments === "string") {
				const argsChunk = tool_call.function.arguments;
				const trimmedChunk = argsChunk.trimStart();
				if (
					(trimmedChunk.startsWith("{") || trimmedChunk.startsWith("[")) &&
					this.tryParseJson(argsChunk) !== undefined
				) {
					pending.arguments = argsChunk;
				} else {
					pending.arguments += argsChunk;
				}
			} else {
				pending.arguments = JSON.stringify(tool_call.function.arguments);
			}
		}
		if (chunk.signature) {
			pending.signature = chunk.signature;
		}
	}

	private finalizePendingToolCalls(
		pendingMap: Map<
			string,
			{ name?: string; arguments: string; signature?: string }
		>,
	): PendingToolCall[] {
		const toolCalls: PendingToolCall[] = [];
		for (const [id, pending] of pendingMap.entries()) {
			if (!pending.name || !pending.arguments) {
				continue;
			}
			const input = this.tryParseJson(pending.arguments);
			if (input === undefined) {
				continue;
			}
			toolCalls.push({
				id,
				name: pending.name,
				input,
				signature: pending.signature,
			});
		}
		return toolCalls;
	}

	private tryParseJson(value: string): unknown | undefined {
		const parsed = parseJsonStream(value);
		return parsed === value ? undefined : parsed;
	}
}
