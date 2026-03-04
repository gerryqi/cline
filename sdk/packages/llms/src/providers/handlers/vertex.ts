/**
 * Vertex Handler
 *
 * Routes Vertex models by family:
 * - Gemini models -> Google GenAI Vertex path via GeminiHandler
 * - Claude models -> AI SDK Google Vertex Anthropic provider
 */

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
import type {
	ImageContent,
	Message,
	TextContent,
	ToolDefinition,
} from "../types/messages";
import { withRetry } from "../utils/retry";
import { BaseHandler } from "./base";
import { GeminiHandler } from "./gemini-base";

const DEFAULT_VERTEX_REGION = "us-central1";

function isClaudeModel(modelId: string): boolean {
	return modelId.toLowerCase().includes("claude");
}

type AiModule = {
	streamText: (input: Record<string, unknown>) => {
		fullStream?: AsyncIterable<{ type?: string; [key: string]: unknown }>;
		usage?: Promise<{
			inputTokens?: number;
			outputTokens?: number;
			reasoningTokens?: number;
			thoughtsTokenCount?: number;
			cachedInputTokens?: number;
			[key: string]: unknown;
		}>;
	};
};

type VertexAnthropicModule = {
	createVertexAnthropic: (options?: {
		project?: string;
		location?: string;
		headers?: Record<string, string | undefined>;
		baseURL?: string;
	}) => (modelId: string) => unknown;
};

type ModelMessagePart = Record<string, unknown>;
type ModelMessage = {
	role: "system" | "user" | "assistant" | "tool";
	content: string | ModelMessagePart[];
};

let cachedAiModule: AiModule | undefined;

async function loadAiModule(): Promise<AiModule> {
	if (cachedAiModule) {
		return cachedAiModule;
	}
	const moduleName = "ai";
	cachedAiModule = (await import(moduleName)) as AiModule;
	return cachedAiModule;
}

function numberOrZero(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toAiSdkTools(
	tools: ToolDefinition[] | undefined,
): Record<string, unknown> | undefined {
	if (!tools || tools.length === 0) {
		return undefined;
	}

	const anthropicTools = convertToolsToAnthropic(tools);
	return Object.fromEntries(
		anthropicTools.map((tool) => [
			tool.name,
			{
				description: tool.description,
				inputSchema: tool.input_schema,
			},
		]),
	);
}

function serializeToolResult(
	content: string | Array<TextContent | ImageContent>,
): string {
	if (typeof content === "string") {
		return content;
	}

	const textParts: string[] = [];
	for (const part of content) {
		if (part.type === "text" && typeof part.text === "string") {
			textParts.push(part.text);
			continue;
		}
		textParts.push(JSON.stringify(part));
	}

	return textParts.join("\n");
}

function toModelMessages(
	systemPrompt: string,
	messages: Message[],
	options?: { promptCacheOn?: boolean },
): ModelMessage[] {
	const systemContent = options?.promptCacheOn
		? [
				{
					type: "text",
					text: systemPrompt,
					providerOptions: {
						anthropic: { cacheControl: { type: "ephemeral" } },
					},
				},
			]
		: systemPrompt;

	const result: ModelMessage[] = [{ role: "system", content: systemContent }];
	const toolNamesById = new Map<string, string>();

	for (const message of messages) {
		if (typeof message.content === "string") {
			result.push({ role: message.role, content: message.content });
			continue;
		}

		if (message.role === "assistant") {
			const parts: ModelMessagePart[] = [];
			for (const block of message.content) {
				if (block.type === "text") {
					parts.push({ type: "text", text: block.text });
					continue;
				}

				if (block.type === "tool_use") {
					toolNamesById.set(block.id, block.name);
					parts.push({
						type: "tool-call",
						toolCallId: block.id,
						toolName: block.name,
						input: block.input,
					});
				}
			}

			if (parts.length > 0) {
				result.push({ role: "assistant", content: parts });
			}
			continue;
		}

		const userParts: ModelMessagePart[] = [];
		for (const block of message.content) {
			if (block.type === "text") {
				userParts.push({ type: "text", text: block.text });
				continue;
			}

			if (block.type === "image") {
				userParts.push({
					type: "image",
					image: Buffer.from(block.data, "base64"),
					mediaType: block.mediaType,
				});
				continue;
			}

			if (block.type === "tool_result") {
				if (userParts.length > 0) {
					result.push({
						role: "user",
						content: userParts.splice(0, userParts.length),
					});
				}

				result.push({
					role: "tool",
					content: [
						{
							type: "tool-result",
							toolCallId: block.tool_use_id,
							toolName: toolNamesById.get(block.tool_use_id) ?? "tool",
							output: serializeToolResult(block.content),
							isError: block.is_error ?? false,
						},
					],
				});
			}
		}

		if (userParts.length > 0) {
			result.push({ role: "user", content: userParts });
		}
	}

	return result;
}

/**
 * Handler for Vertex AI that supports both Gemini and Claude models.
 */
export class VertexHandler extends BaseHandler {
	private geminiHandler: GeminiHandler | undefined;
	private vertexAnthropicModelFactory:
		| ((modelId: string) => unknown)
		| undefined;
	private vertexAnthropicModelFactoryPromise:
		| Promise<(modelId: string) => unknown>
		| undefined;

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

	private async ensureVertexAnthropicModelFactory(): Promise<
		(modelId: string) => unknown
	> {
		if (this.vertexAnthropicModelFactory) {
			return this.vertexAnthropicModelFactory;
		}
		if (!this.vertexAnthropicModelFactoryPromise) {
			this.vertexAnthropicModelFactoryPromise = import(
				"@ai-sdk/google-vertex/anthropic"
			).then((module) => {
				const provider = (
					module as VertexAnthropicModule
				).createVertexAnthropic({
					project: this.getProjectId(),
					location: this.getRequiredClaudeRegion(),
					headers: this.getRequestHeaders(),
					baseURL: this.config.baseUrl,
				});
				const modelFactory = (modelId: string) => provider(modelId);
				this.vertexAnthropicModelFactory = modelFactory;
				return modelFactory;
			});
		}
		try {
			return await this.vertexAnthropicModelFactoryPromise;
		} catch (error) {
			this.vertexAnthropicModelFactoryPromise = undefined;
			if (
				error instanceof Error &&
				error.message.includes("@ai-sdk/google-vertex")
			) {
				throw new Error(
					'Vertex Claude models require @ai-sdk/google-vertex at runtime. Install workspace dependencies before using provider "vertex".',
					{ cause: error },
				);
			}
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

		const ai = await loadAiModule();
		const modelFactory = await this.ensureVertexAnthropicModelFactory();
		const responseId = this.createResponseId();

		const budgetTokens = this.config.thinkingBudgetTokens ?? 0;
		const reasoningOn =
			hasModelCapability(model.info, "reasoning") && budgetTokens > 0;
		const promptCacheOn = hasModelCapability(model.info, "prompt-cache");

		const providerOptions: Record<string, unknown> = {};
		if (reasoningOn) {
			providerOptions.anthropic = {
				thinking: { type: "enabled", budgetTokens },
			};
		}

		const stream = ai.streamText({
			model: modelFactory(model.id),
			messages: toModelMessages(systemPrompt, messages, { promptCacheOn }),
			tools: toAiSdkTools(tools),
			maxTokens: model.info.maxTokens ?? 8192,
			temperature: reasoningOn ? undefined : 0,
			providerOptions:
				Object.keys(providerOptions).length > 0 ? providerOptions : undefined,
			abortSignal: this.getAbortSignal(),
		});

		let usageEmitted = false;

		if (stream.fullStream) {
			for await (const part of stream.fullStream) {
				const partType = part.type;

				if (partType === "text-delta") {
					const text =
						(part.textDelta as string | undefined) ??
						(part.text as string | undefined) ??
						(part.delta as string | undefined);
					if (text) {
						yield { type: "text", text, id: responseId };
					}
					continue;
				}

				if (partType === "reasoning-delta") {
					const reasoning =
						(part.textDelta as string | undefined) ??
						(part.text as string | undefined);
					if (reasoning) {
						yield { type: "reasoning", reasoning, id: responseId };
					}
					continue;
				}

				if (partType === "tool-call") {
					const toolCallId =
						(part.toolCallId as string | undefined) ??
						(part.id as string | undefined);
					const toolName =
						(part.toolName as string | undefined) ??
						(part.name as string | undefined);
					const args =
						(part.input as Record<string, unknown> | undefined) ??
						(part.args as Record<string, unknown> | undefined) ??
						{};

					yield {
						type: "tool_calls",
						id: responseId,
						tool_call: {
							call_id: toolCallId,
							function: {
								id: toolCallId,
								name: toolName,
								arguments: args,
							},
						},
					};
					continue;
				}

				if (partType === "error") {
					const message =
						(part.error as Error | undefined)?.message ??
						"Vertex Anthropic stream failed";
					throw new Error(message);
				}

				if (partType === "finish") {
					const usage =
						(part.totalUsage as Record<string, unknown> | undefined) ??
						(part.usage as Record<string, unknown> | undefined) ??
						{};
					const providerMetadata = (part.providerMetadata ?? {}) as Record<
						string,
						unknown
					>;
					const anthropicMetadata =
						(providerMetadata.anthropic as
							| Record<string, unknown>
							| undefined) ?? {};

					const inputTokens = numberOrZero(usage.inputTokens);
					const outputTokens = numberOrZero(usage.outputTokens);
					const thoughtsTokenCount = numberOrZero(
						usage.reasoningTokens ?? usage.thoughtsTokenCount,
					);
					const cacheReadTokens = numberOrZero(
						usage.cachedInputTokens ?? anthropicMetadata.cacheReadInputTokens,
					);
					const cacheWriteTokens = numberOrZero(
						anthropicMetadata.cacheCreationInputTokens,
					);

					yield {
						type: "usage",
						inputTokens: Math.max(0, inputTokens - cacheReadTokens),
						outputTokens,
						thoughtsTokenCount,
						cacheReadTokens,
						cacheWriteTokens,
						totalCost: this.calculateCost(
							inputTokens,
							outputTokens,
							cacheReadTokens,
						),
						id: responseId,
					};
					usageEmitted = true;
				}
			}
		}

		if (!usageEmitted && stream.usage) {
			const usage = await stream.usage;
			const inputTokens = numberOrZero(usage.inputTokens);
			const outputTokens = numberOrZero(usage.outputTokens);
			const thoughtsTokenCount = numberOrZero(
				usage.reasoningTokens ?? usage.thoughtsTokenCount,
			);
			const cacheReadTokens = numberOrZero(usage.cachedInputTokens);

			yield {
				type: "usage",
				inputTokens: Math.max(0, inputTokens - cacheReadTokens),
				outputTokens,
				thoughtsTokenCount,
				cacheReadTokens,
				totalCost: this.calculateCost(
					inputTokens,
					outputTokens,
					cacheReadTokens,
				),
				id: responseId,
			};
		}

		yield { type: "done", success: true, id: responseId };
	}
}

/**
 * Create a Vertex handler
 */
export function createVertexHandler(config: ProviderConfig): VertexHandler {
	return new VertexHandler(config);
}
