/**
 * Vertex Handler
 *
 * Routes Vertex models by family:
 * - Gemini models -> Google GenAI Vertex path via GeminiHandler
 * - Claude models -> Anthropic Vertex SDK
 */

import type { AnthropicVertex } from "@anthropic-ai/vertex-sdk";
import {
	convertToAnthropicMessages,
	convertToolsToAnthropic,
} from "../transform/anthropic-format";
import {
	type ApiStream,
	type HandlerModelInfo,
	hasModelCapability,
	type ProviderConfig,
} from "../types";
import type { Message, ToolDefinition } from "../types/messages";
import { withRetry } from "../utils/retry";
import { BaseHandler } from "./base";
import { GeminiHandler } from "./gemini-base";

const DEFAULT_VERTEX_REGION = "us-central1";

function isClaudeModel(modelId: string): boolean {
	return modelId.toLowerCase().includes("claude");
}

/**
 * Handler for Vertex AI that supports both Gemini and Claude models.
 */
export class VertexHandler extends BaseHandler {
	private geminiHandler: GeminiHandler | undefined;
	private anthropicClient: AnthropicVertex | undefined;
	private anthropicClientPromise: Promise<AnthropicVertex> | undefined;

	private getProjectId(): string {
		const projectId = this.config.gcp?.projectId?.trim();
		if (!projectId) {
			throw new Error(
				"Vertex provider requires `gcp.projectId` in provider configuration.",
			);
		}
		return projectId;
	}

	private getConfiguredRegion(): string | undefined {
		return this.config.gcp?.region?.trim() || this.config.region?.trim();
	}

	private getRequiredClaudeRegion(): string {
		const region = this.getConfiguredRegion();
		if (!region) {
			throw new Error(
				"Vertex Claude models require `gcp.region` (or `region`) in provider configuration.",
			);
		}
		return region;
	}

	private getGeminiRegion(): string {
		return this.getConfiguredRegion() ?? DEFAULT_VERTEX_REGION;
	}

	private ensureGeminiHandler(): GeminiHandler {
		if (!this.geminiHandler) {
			const projectId = this.getProjectId();
			const region = this.getGeminiRegion();
			this.geminiHandler = new GeminiHandler({
				...this.config,
				region,
				gcp: {
					...this.config.gcp,
					projectId,
					region,
				},
			});
		}
		return this.geminiHandler;
	}

	private async ensureAnthropicClient(): Promise<AnthropicVertex> {
		if (this.anthropicClient) {
			return this.anthropicClient;
		}
		if (!this.anthropicClientPromise) {
			this.anthropicClientPromise = import("@anthropic-ai/vertex-sdk").then(
				({ AnthropicVertex }) => {
					const client = new AnthropicVertex({
						projectId: this.getProjectId(),
						region: this.getRequiredClaudeRegion(),
						defaultHeaders: this.getRequestHeaders(),
					});
					this.anthropicClient = client;
					return client;
				},
			);
		}
		try {
			return await this.anthropicClientPromise;
		} catch (error) {
			this.anthropicClientPromise = undefined;
			throw error;
		}
	}

	private resolveModel(): HandlerModelInfo {
		const modelId = this.config.modelId;
		const knownModels = this.config.knownModels ?? {};
		const fallbackModel = knownModels[modelId] ?? {};
		const modelInfo = this.config.modelInfo ?? fallbackModel;
		return { id: modelId, info: { ...modelInfo, id: modelId } };
	}

	getModel(): HandlerModelInfo {
		return this.resolveModel();
	}

	getMessages(systemPrompt: string, messages: Message[]): unknown {
		const model = this.resolveModel();
		if (!isClaudeModel(model.id)) {
			return this.ensureGeminiHandler().getMessages(systemPrompt, messages);
		}
		const supportsPromptCache = hasModelCapability(model.info, "prompt-cache");
		return convertToAnthropicMessages(messages, supportsPromptCache);
	}

	@withRetry()
	async *createMessage(
		systemPrompt: string,
		messages: Message[],
		tools?: ToolDefinition[],
	): ApiStream {
		const model = this.resolveModel();

		if (!isClaudeModel(model.id)) {
			yield* this.ensureGeminiHandler().createMessage(
				systemPrompt,
				messages,
				tools,
			);
			return;
		}

		const client = await this.ensureAnthropicClient();
		const responseId = this.createResponseId();

		const budgetTokens = this.config.thinkingBudgetTokens ?? 0;
		const nativeToolsOn = !!tools?.length;
		const supportsPromptCache = hasModelCapability(model.info, "prompt-cache");
		const reasoningOn =
			hasModelCapability(model.info, "reasoning") && budgetTokens > 0;
		const anthropicMessages = convertToAnthropicMessages(
			messages,
			supportsPromptCache,
		);
		const anthropicTools = nativeToolsOn
			? convertToolsToAnthropic(tools)
			: undefined;

		const stream = await client.beta.messages.create({
			model: model.id,
			max_tokens: model.info.maxTokens || 8192,
			thinking: reasoningOn
				? { type: "enabled", budget_tokens: budgetTokens }
				: undefined,
			temperature: reasoningOn ? undefined : 0,
			system: supportsPromptCache
				? [
						{
							type: "text",
							text: systemPrompt,
							cache_control: { type: "ephemeral" },
						},
					]
				: [{ type: "text", text: systemPrompt }],
			messages: anthropicMessages as any,
			stream: true,
			tools: anthropicTools as any,
			tool_choice: nativeToolsOn && !reasoningOn ? { type: "any" } : undefined,
		});

		const currentToolCall = { id: "", name: "" };

		for await (const chunk of stream) {
			yield* this.withResponseIdForAll(
				this.processChunk(chunk, currentToolCall),
				responseId,
			);
		}

		yield { type: "done", success: true, id: responseId };
	}

	private *processChunk(
		chunk: any,
		currentToolCall: { id: string; name: string },
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
					id: "",
				};
				break;
			}
			case "message_delta": {
				yield {
					type: "usage",
					inputTokens: 0,
					outputTokens: chunk.usage.output_tokens || 0,
					id: "",
				};
				break;
			}
			case "content_block_start": {
				const block = chunk.content_block;
				switch (block.type) {
					case "thinking":
						yield {
							type: "reasoning",
							reasoning: block.thinking || "",
							id: "",
						};
						break;
					case "redacted_thinking":
						yield {
							type: "reasoning",
							reasoning: "[Redacted thinking block]",
							id: "",
						};
						break;
					case "tool_use":
						currentToolCall.id = block.id;
						currentToolCall.name = block.name;
						break;
					case "text":
						yield { type: "text", text: block.text, id: "" };
						break;
				}
				break;
			}
			case "content_block_delta": {
				const delta = chunk.delta;
				switch (delta.type) {
					case "signature_delta":
						yield {
							type: "reasoning",
							reasoning: "",
							signature: delta.signature,
							id: "",
						};
						break;
					case "thinking_delta":
						yield { type: "reasoning", reasoning: delta.thinking, id: "" };
						break;
					case "input_json_delta":
						if (
							currentToolCall.id &&
							currentToolCall.name &&
							delta.partial_json
						) {
							yield {
								type: "tool_calls",
								tool_call: {
									call_id: currentToolCall.id,
									function: {
										id: currentToolCall.id,
										name: currentToolCall.name,
										arguments: delta.partial_json,
									},
								},
								id: "",
							};
						}
						break;
					case "text_delta":
						yield { type: "text", text: delta.text, id: "" };
						break;
				}
				break;
			}
			case "content_block_stop":
				currentToolCall.id = "";
				currentToolCall.name = "";
				break;
		}
	}
}

/**
 * Create a Vertex handler
 */
export function createVertexHandler(config: ProviderConfig): VertexHandler {
	return new VertexHandler(config);
}
