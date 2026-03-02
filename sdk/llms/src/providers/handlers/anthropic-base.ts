/**
 * Anthropic Base Handler
 *
 * Handler for Anthropic's API using the official SDK.
 * Supports prompt caching, extended thinking, and native tool calling.
 */

import { Anthropic } from "@anthropic-ai/sdk";
import type {
	Tool as AnthropicTool,
	RawMessageStreamEvent,
} from "@anthropic-ai/sdk/resources";
import {
	convertToAnthropicMessages,
	convertToolsToAnthropic,
} from "../transform/anthropic-format";
import {
	type ApiStream,
	type HandlerModelInfo,
	hasModelCapability,
	type ProviderConfig,
	supportsModelThinking,
} from "../types";
import type { Message, ToolDefinition } from "../types/messages";
import { withRetry } from "../utils/retry";
import { getMissingApiKeyError, resolveApiKeyForProvider } from "./auth";
import { BaseHandler, DEFAULT_MODEL_INFO } from "./base";

const DEFAULT_THINKING_BUDGET_TOKENS = 1024;
const THINKING_DEBUG_ENV = "CLINE_DEBUG_THINKING";

function isThinkingDebugEnabled(): boolean {
	const raw = process.env[THINKING_DEBUG_ENV];
	if (!raw) {
		return false;
	}
	const normalized = raw.trim().toLowerCase();
	return normalized === "1" || normalized === "true" || normalized === "yes";
}

/**
 * Handler for Anthropic's API
 */
export class AnthropicHandler extends BaseHandler {
	private client: Anthropic | undefined;

	private ensureClient(): Anthropic {
		if (!this.client) {
			const apiKey = resolveApiKeyForProvider(
				this.config.providerId,
				this.config.apiKey,
			);
			if (!apiKey) {
				throw new Error(getMissingApiKeyError(this.config.providerId));
			}

			this.client = new Anthropic({
				apiKey,
				baseURL: this.config.baseUrl || undefined,
				defaultHeaders: this.getRequestHeaders(),
			});
		}
		return this.client;
	}

	getModel(): HandlerModelInfo {
		const modelId = this.config.modelId;
		const knownModels = this.config.knownModels ?? {};
		const fallbackModel = knownModels[modelId] ?? DEFAULT_MODEL_INFO;
		const modelInfo = this.config.modelInfo ?? fallbackModel;

		return { id: modelId, info: { ...modelInfo, id: modelId } };
	}

	getMessages(
		_systemPrompt: string,
		messages: Message[],
	): Anthropic.MessageParam[] {
		const supportsPromptCache = hasModelCapability(
			this.getModel().info,
			"prompt-cache",
		);
		return convertToAnthropicMessages(
			messages,
			supportsPromptCache,
		) as Anthropic.MessageParam[];
	}

	@withRetry()
	async *createMessage(
		systemPrompt: string,
		messages: Message[],
		tools?: ToolDefinition[],
	): ApiStream {
		const client = this.ensureClient();
		const model = this.getModel();
		const abortSignal = this.getAbortSignal();
		const responseId = this.createResponseId();

		const thinkingSupported = supportsModelThinking(model.info);
		const requestedBudget =
			this.config.thinkingBudgetTokens ??
			(this.config.thinking ? DEFAULT_THINKING_BUDGET_TOKENS : 0);
		const budgetTokens =
			thinkingSupported && requestedBudget > 0 ? requestedBudget : 0;
		const nativeToolsOn = tools && tools.length > 0;
		const supportsPromptCache = hasModelCapability(model.info, "prompt-cache");
		const reasoningOn = thinkingSupported && budgetTokens > 0;
		const debugThinking = isThinkingDebugEnabled();
		const debugChunkCounts: Record<string, number> = {};
		const countChunk = (type: string): void => {
			debugChunkCounts[type] = (debugChunkCounts[type] ?? 0) + 1;
		};

		if (debugThinking) {
			console.error(
				`[thinking-debug][anthropic][request] model=${model.id} thinkingFlag=${this.config.thinking === true} supportsModelThinking=${thinkingSupported} requestedBudget=${requestedBudget} effectiveBudget=${budgetTokens} reasoningOn=${reasoningOn} promptCache=${supportsPromptCache}`,
			);
		}

		// Convert messages
		const anthropicMessages = this.getMessages(systemPrompt, messages);

		// Convert tools
		const anthropicTools: AnthropicTool[] | undefined = nativeToolsOn
			? convertToolsToAnthropic(tools)
			: undefined;

		// Request options with abort signal
		const requestOptions = { signal: abortSignal };

		// Create the request
		const stream = await client.messages.create(
			{
				model: model.id,
				thinking: reasoningOn
					? { type: "enabled", budget_tokens: budgetTokens }
					: undefined,
				max_tokens: model.info.maxTokens || 8192,
				temperature: reasoningOn ? undefined : 0,
				system: supportsPromptCache
					? [
							{
								text: systemPrompt,
								type: "text",
								cache_control: { type: "ephemeral" },
							},
						]
					: [{ text: systemPrompt, type: "text" }],
				messages: anthropicMessages as Anthropic.MessageParam[],
				stream: true,
				tools: anthropicTools,
				tool_choice:
					nativeToolsOn && !reasoningOn ? { type: "auto" } : undefined,
			},
			requestOptions,
		);

		// Track tool call state
		const currentToolCall = { id: "", name: "", arguments: "" };

		for await (const chunk of stream) {
			if (debugThinking) {
				countChunk(`event:${chunk.type}`);
				if (chunk.type === "content_block_start") {
					countChunk(
						`content_block_start:${chunk.content_block?.type ?? "unknown"}`,
					);
				} else if (chunk.type === "content_block_delta") {
					countChunk(`content_block_delta:${chunk.delta?.type ?? "unknown"}`);
				}
			}
			yield* this.withResponseIdForAll(
				this.processChunk(chunk, currentToolCall, responseId),
				responseId,
			);
		}

		if (debugThinking) {
			const summary = Object.entries(debugChunkCounts)
				.map(([key, count]) => `${key}=${count}`)
				.sort()
				.join(" ");
			console.error(`[thinking-debug][anthropic][stream] ${summary}`);
		}

		// Yield done chunk to indicate streaming completed successfully
		yield { type: "done", success: true, id: responseId };
	}

	private *processChunk(
		chunk: RawMessageStreamEvent,
		currentToolCall: { id: string; name: string; arguments: string },
		responseId: string,
	): Generator<import("../types").ApiStreamChunk> {
		switch (chunk.type) {
			case "message_start": {
				const usage = chunk.message.usage;
				yield {
					type: "usage",
					inputTokens: usage.input_tokens || 0,
					outputTokens: usage.output_tokens || 0,
					cacheWriteTokens: (usage as any).cache_creation_input_tokens,
					cacheReadTokens: (usage as any).cache_read_input_tokens,
					id: responseId,
				};
				break;
			}

			case "message_delta": {
				yield {
					type: "usage",
					inputTokens: 0,
					outputTokens: chunk.usage.output_tokens || 0,
					id: responseId,
				};
				break;
			}

			case "content_block_start": {
				const block = chunk.content_block;
				switch (block.type) {
					case "thinking":
						yield {
							type: "reasoning",
							reasoning:
								typeof (block as { thinking?: unknown }).thinking === "string"
									? ((block as { thinking: string }).thinking ?? "")
									: "",
							signature:
								typeof (block as { signature?: unknown }).signature === "string"
									? ((block as { signature: string }).signature ?? undefined)
									: undefined,
							id: responseId,
						};
						break;
					case "redacted_thinking":
						yield {
							type: "reasoning",
							reasoning: "",
							redacted_data:
								typeof (block as { data?: unknown }).data === "string"
									? ((block as { data: string }).data ?? undefined)
									: undefined,
							id: responseId,
						};
						break;
					case "text":
						yield { type: "text", text: "", id: responseId };
						break;
					case "tool_use":
						currentToolCall.id = block.id;
						currentToolCall.name = block.name;
						currentToolCall.arguments = "";
						break;
				}
				break;
			}

			case "content_block_delta": {
				const delta = chunk.delta;
				switch (delta.type) {
					case "thinking_delta":
						yield {
							type: "reasoning",
							reasoning: delta.thinking,
							id: responseId,
						};
						break;
					case "signature_delta":
						yield {
							type: "reasoning",
							reasoning: "",
							signature:
								typeof (delta as { signature?: unknown }).signature === "string"
									? ((delta as { signature: string }).signature ?? undefined)
									: undefined,
							id: responseId,
						};
						break;
					case "text_delta":
						yield { type: "text", text: delta.text, id: responseId };
						break;
					case "input_json_delta":
						currentToolCall.arguments += delta.partial_json;
						break;
				}
				break;
			}

			case "content_block_stop": {
				// If we have a tool call, yield it
				if (currentToolCall.id) {
					let parsedArgs: Record<string, unknown>;
					try {
						parsedArgs = JSON.parse(currentToolCall.arguments || "{}");
					} catch {
						parsedArgs = {};
					}

					yield {
						type: "tool_calls",
						id: responseId,
						tool_call: {
							call_id: currentToolCall.id,
							function: {
								name: currentToolCall.name,
								arguments: parsedArgs,
							},
						},
					};

					// Reset tool call state
					currentToolCall.id = "";
					currentToolCall.name = "";
					currentToolCall.arguments = "";
				}
				break;
			}
		}
	}
}

/**
 * Create an Anthropic handler
 */
export function createAnthropicHandler(
	config: ProviderConfig,
): AnthropicHandler {
	return new AnthropicHandler(config);
}
