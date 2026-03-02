/**
 * Base Handler
 *
 * Abstract base class that provides common functionality for all handlers.
 */

import { nanoid } from "nanoid";
import type {
	ApiHandler,
	ApiStream,
	ApiStreamUsageChunk,
	HandlerModelInfo,
	ModelInfo,
	ProviderConfig,
} from "../types";
import type { Message, ToolDefinition } from "../types/messages";
import type { ApiStreamChunk } from "../types/stream";

export const DEFAULT_REQUEST_HEADERS: Record<string, string> = {
	"HTTP-Referer": "https://cline.bot",
	"X-Title": "Cline",
	"X-IS-MULTIROOT": "false",
	"X-CLIENT-TYPE": "cline-sdk",
};

/**
 * Default model info when none is provided
 */
export const DEFAULT_MODEL_INFO: ModelInfo = {
	id: "default",
	name: "Default Model",
	contextWindow: 128_000,
	maxTokens: 4_096,
	capabilities: ["tools"],
	pricing: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
	},
};

/**
 * Base handler class with common functionality
 */
export abstract class BaseHandler implements ApiHandler {
	protected config: ProviderConfig;
	protected abortController: AbortController | undefined;

	constructor(config: ProviderConfig) {
		this.config = config;
	}

	/**
	 * Convert Cline messages to provider-specific format
	 * Must be implemented by subclasses
	 */
	abstract getMessages(systemPrompt: string, messages: Message[]): unknown;

	/**
	 * Create a streaming message completion
	 * Must be implemented by subclasses
	 */
	abstract createMessage(
		systemPrompt: string,
		messages: Message[],
		tools?: ToolDefinition[],
	): ApiStream;

	/**
	 * Get the current model configuration
	 * Can be overridden by subclasses for provider-specific logic
	 */
	getModel(): HandlerModelInfo {
		const modelId = this.config.modelId;
		return {
			id: modelId,
			info: { ...(this.config.modelInfo ?? DEFAULT_MODEL_INFO), id: modelId },
		};
	}

	/**
	 * Get usage information (optional)
	 * Override in subclasses that support this
	 */
	async getApiStreamUsage(): Promise<ApiStreamUsageChunk | undefined> {
		return undefined;
	}

	/**
	 * Get the abort signal for the current request
	 * Creates a new AbortController if one doesn't exist or was already aborted
	 * Combines with config.abortSignal if provided
	 */
	protected getAbortSignal(): AbortSignal {
		// Create a new controller if needed
		if (!this.abortController || this.abortController.signal.aborted) {
			this.abortController = new AbortController();
		}

		// If a signal was provided in config, chain it
		if (this.config.abortSignal) {
			const configSignal = this.config.abortSignal;
			if (configSignal.aborted) {
				this.abortController.abort(configSignal.reason);
			} else {
				configSignal.addEventListener("abort", () => {
					this.abortController?.abort(configSignal.reason);
				});
			}
		}

		return this.abortController.signal;
	}

	/**
	 * Abort the current request
	 */
	abort(): void {
		this.abortController?.abort();
	}

	/**
	 * Helper to calculate cost from usage
	 */
	protected calculateCost(
		inputTokens: number,
		outputTokens: number,
		cacheReadTokens = 0,
	): number | undefined {
		const pricing = this.config.modelInfo?.pricing;
		if (!pricing?.input || !pricing?.output) {
			return undefined;
		}

		const uncachedInputTokens = inputTokens - cacheReadTokens;
		const inputCost = (uncachedInputTokens / 1_000_000) * pricing.input;
		const outputCost = (outputTokens / 1_000_000) * pricing.output;
		const cacheReadCost =
			cacheReadTokens > 0
				? (cacheReadTokens / 1_000_000) * (pricing.cacheRead ?? 0)
				: 0;

		return inputCost + outputCost + cacheReadCost;
	}

	protected createResponseId(): string {
		return nanoid();
	}

	protected withResponseId<T extends ApiStreamChunk>(
		chunk: T,
		responseId: string,
	): T {
		return { ...chunk, id: responseId };
	}

	protected *withResponseIdForAll(
		chunks: Iterable<ApiStreamChunk>,
		responseId: string,
	): Generator<ApiStreamChunk> {
		for (const chunk of chunks) {
			yield this.withResponseId(chunk, responseId);
		}
	}

	protected getRequestHeaders(): Record<string, string> {
		return {
			...DEFAULT_REQUEST_HEADERS,
			...(this.config.headers ?? {}),
		};
	}
}
