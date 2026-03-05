/**
 * Agent Class
 *
 * The main class for building and running agentic loops with LLMs.
 */

import { providers } from "@cline/llms";
import { buildInitialUserContent } from "./agent-input.js";
import {
	type AgentExtensionRunner,
	createExtensionRunner,
} from "./extensions.js";
import {
	type HookDispatchInput,
	HookEngine,
	registerLifecycleHandlers,
} from "./hooks/index.js";
import { MessageBuilder } from "./message-builder.js";
import {
	createToolRegistry,
	executeToolsInParallel,
	formatToolResult,
	toToolDefinitions,
	validateTools,
} from "./tools/index.js";
import type {
	AgentConfig,
	AgentEvent,
	AgentExtensionRegistry,
	AgentFinishReason,
	AgentHookControl,
	AgentResult,
	AgentUsage,
	PendingToolCall,
	ProcessedTurn,
	Tool,
	ToolApprovalResult,
	ToolCallRecord,
	ToolContext,
	ToolPolicy,
} from "./types.js";

// =============================================================================
// Agent Class
// =============================================================================

/**
 * Agent class for building and running agentic loops
 *
 * @example
 * ```typescript
 * const agent = new Agent({
 *   providerId: "anthropic",
 *   modelId: "claude-sonnet-4-5-20250929",
 *   apiKey: process.env.ANTHROPIC_API_KEY,
 *   systemPrompt: "You are a helpful coding assistant.",
 *   tools: [readFile, writeFile, runCommand],
 * })
 *
 * const result = await agent.run("Help me refactor this code")
 * console.log(result.text)
 * ```
 */
const DEFAULT_REMINDER_TEXT =
	"REMINDER: If you have gathered enough information to answer the user's question, please provide your final answer now without using any more tools.";

export class Agent {
	private config: Required<
		Pick<
			AgentConfig,
			| "providerId"
			| "modelId"
			| "systemPrompt"
			| "tools"
			| "apiTimeoutMs"
			| "maxTokensPerTurn"
			| "reminderAfterIterations"
			| "reminderText"
			| "hookErrorMode"
		>
	> &
		AgentConfig;
	private handler: providers.ApiHandler;
	private toolRegistry: Map<string, Tool>;
	private messages: providers.Message[] = [];
	private conversationId: string;
	private agentId: string;
	private parentAgentId: string | null;
	private abortController: AbortController | null = null;
	private extensionRunner: AgentExtensionRunner;
	private readonly hookEngine: HookEngine;
	private messageBuilder: MessageBuilder;
	private extensionsInitialized = false;
	private sessionStarted = false;
	private activeRunId = "";

	constructor(config: AgentConfig) {
		// Set defaults
		this.config = {
			...config,
			maxIterations: config.maxIterations,
			apiTimeoutMs: config.apiTimeoutMs ?? 120000,
			maxTokensPerTurn: config.maxTokensPerTurn ?? 8192,
			reminderAfterIterations: config.reminderAfterIterations ?? 50,
			reminderText: config.reminderText ?? DEFAULT_REMINDER_TEXT,
			hookErrorMode: config.hookErrorMode ?? "ignore",
			extensions: config.extensions ?? [],
			toolPolicies: config.toolPolicies ?? {},
		};

		this.extensionRunner = createExtensionRunner({
			extensions: this.config.extensions,
		});
		const defaultFailureMode =
			this.config.hookErrorMode === "throw" ? "fail_closed" : "fail_open";
		this.hookEngine = new HookEngine({
			policies: {
				defaultPolicy: {
					failureMode: defaultFailureMode,
				},
				...this.config.hookPolicies,
			},
			onDispatchError: (error) => {
				this.reportRecoverableError(error);
			},
		});
		this.messageBuilder = new MessageBuilder();
		this.toolRegistry = createToolRegistry([]);
		registerLifecycleHandlers(this.hookEngine, this.config);

		// Create handler
		this.handler = providers.createHandler({
			providerId: config.providerId,
			modelId: config.modelId,
			apiKey: config.apiKey,
			baseUrl: config.baseUrl,
			headers: config.headers,
			knownModels: config.knownModels,
			maxOutputTokens: config.maxTokensPerTurn,
			reasoningEffort: config.reasoningEffort,
			thinkingBudgetTokens: config.thinkingBudgetTokens,
			thinking: config.thinking,
			abortSignal: config.abortSignal,
		});

		// Generate IDs
		this.agentId = `agent_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
		this.conversationId = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
		this.parentAgentId = config.parentAgentId ?? null;
		if ((config.initialMessages?.length ?? 0) > 0) {
			this.restore(config.initialMessages ?? []);
		}
	}

	/**
	 * Run the agent with a user message
	 *
	 * This starts a new conversation with the given message and runs the
	 * agentic loop until completion, max iterations, or abort.
	 */
	async run(
		userMessage: string,
		userImages?: string[],
		userFiles?: string[],
	): Promise<AgentResult> {
		await this.ensureExtensionsInitialized();

		// Start fresh conversation
		this.messages = [];
		this.conversationId = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
		this.sessionStarted = false;

		const preparedInput = await this.prepareUserInput(userMessage, "run");
		if (preparedInput.cancel) {
			return this.buildAbortedResult(new Date(), "");
		}

		// Add user message
		this.messages.push({
			role: "user",
			content: await this.buildInitialUserContent(
				preparedInput.input,
				userImages,
				userFiles,
			),
		});

		return this.executeLoop(preparedInput.input);
	}

	/**
	 * Continue an existing conversation with a new user message
	 */
	async continue(
		userMessage: string,
		userImages?: string[],
		userFiles?: string[],
	): Promise<AgentResult> {
		await this.ensureExtensionsInitialized();

		const preparedInput = await this.prepareUserInput(userMessage, "continue");
		if (preparedInput.cancel) {
			return this.buildAbortedResult(new Date(), "");
		}

		// Add user message to existing conversation
		this.messages.push({
			role: "user",
			content: await this.buildInitialUserContent(
				preparedInput.input,
				userImages,
				userFiles,
			),
		});

		return this.executeLoop(preparedInput.input);
	}

	/**
	 * Get the current conversation messages
	 */
	getMessages(): providers.Message[] {
		return [...this.messages];
	}

	/**
	 * Clear the conversation history
	 */
	clearHistory(): void {
		this.messages = [];
		this.conversationId = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
		this.sessionStarted = false;
	}

	/**
	 * Replace conversation history with preloaded messages for resume flows.
	 */
	restore(messages: providers.Message[]): void {
		this.messages = [...messages];
		this.conversationId = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
		this.sessionStarted = false;
	}

	/**
	 * Abort the current run
	 */
	abort(): void {
		this.abortController?.abort();
	}

	/**
	 * Trigger session shutdown hooks.
	 * Use this when host applications terminate a session (for example Ctrl+D).
	 */
	async shutdown(reason?: string): Promise<void> {
		await this.dispatchLifecycle("hook.session_shutdown", {
			stage: "session_shutdown",
			payload: {
				agentId: this.agentId,
				conversationId: this.conversationId,
				parentAgentId: this.parentAgentId,
				reason,
			},
		});
		await this.hookEngine.shutdown();
	}

	/**
	 * Inspect registered extension contributions.
	 */
	getExtensionRegistry(): AgentExtensionRegistry {
		return this.extensionRunner.getRegistrySnapshot();
	}

	/**
	 * Get the agent ID
	 */
	getAgentId(): string {
		return this.agentId;
	}

	/**
	 * Get the conversation ID
	 */
	getConversationId(): string {
		return this.conversationId;
	}

	// ===========================================================================
	// Private Methods
	// ===========================================================================

	private async dispatchLifecycle(
		source: string,
		input: Pick<
			HookDispatchInput,
			"stage" | "payload" | "iteration" | "parentEventId"
		>,
	): Promise<AgentHookControl | undefined> {
		const dispatchResult = await this.hookEngine.dispatch({
			...input,
			runId: this.activeRunId || this.conversationId,
			agentId: this.agentId,
			conversationId: this.conversationId,
			parentAgentId: this.parentAgentId,
		});
		if (dispatchResult.control?.context) {
			this.appendHookContext(source, dispatchResult.control.context);
		}
		return dispatchResult.control;
	}

	/**
	 * Execute the agentic loop
	 */
	private async executeLoop(triggerMessage: string): Promise<AgentResult> {
		const startedAt = new Date();
		this.activeRunId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
		this.abortController = new AbortController();

		// Merge abort signals
		const abortSignal = this.mergeAbortSignals(
			this.config.abortSignal,
			this.abortController.signal,
		);

		// Initialize tracking
		let iteration = 0;
		let finishReason: AgentFinishReason = "completed";
		let finalText = "";
		const allToolCalls: ToolCallRecord[] = [];
		const totalUsage: AgentUsage = {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalCost: 0,
		};

		try {
			if (!this.sessionStarted) {
				const sessionStartControl = await this.dispatchLifecycle(
					"hook.session_start",
					{
						stage: "session_start",
						payload: {
							agentId: this.agentId,
							conversationId: this.conversationId,
							parentAgentId: this.parentAgentId,
						},
					},
				);
				if (sessionStartControl?.cancel) {
					finishReason = "aborted";
				}
				this.sessionStarted = true;
			}

			const runStartControl = await this.dispatchLifecycle("hook.run_start", {
				stage: "run_start",
				payload: {
					agentId: this.agentId,
					conversationId: this.conversationId,
					parentAgentId: this.parentAgentId,
					userMessage: triggerMessage,
				},
			});
			if (runStartControl?.cancel) {
				finishReason = "aborted";
			}

			// Main loop
			while (finishReason !== "aborted") {
				if (
					this.config.maxIterations !== undefined &&
					iteration >= this.config.maxIterations
				) {
					finishReason = "max_iterations";
					break;
				}

				// Check for abort
				if (abortSignal.aborted) {
					finishReason = "aborted";
					break;
				}

				iteration++;
				const iterationStartControl = await this.dispatchLifecycle(
					"hook.iteration_start",
					{
						stage: "iteration_start",
						iteration,
						payload: {
							agentId: this.agentId,
							conversationId: this.conversationId,
							parentAgentId: this.parentAgentId,
							iteration,
						},
					},
				);
				if (iterationStartControl?.cancel) {
					finishReason = "aborted";
					break;
				}

				this.emit({ type: "iteration_start", iteration });

				const turnStartControl = await this.dispatchLifecycle(
					"hook.turn_start",
					{
						stage: "turn_start",
						iteration,
						payload: {
							agentId: this.agentId,
							conversationId: this.conversationId,
							parentAgentId: this.parentAgentId,
							iteration,
							messages: [...this.messages],
						},
					},
				);
				if (turnStartControl?.cancel) {
					finishReason = "aborted";
					break;
				}

				const beforeAgentStartControl = await this.dispatchLifecycle(
					"hook.before_agent_start",
					{
						stage: "before_agent_start",
						iteration,
						payload: {
							agentId: this.agentId,
							conversationId: this.conversationId,
							parentAgentId: this.parentAgentId,
							iteration,
							systemPrompt: this.config.systemPrompt,
							messages: [...this.messages],
						},
					},
				);
				const beforeAgentStartSystemPrompt =
					typeof beforeAgentStartControl?.systemPrompt === "string"
						? beforeAgentStartControl.systemPrompt
						: this.config.systemPrompt;
				if (beforeAgentStartControl?.cancel) {
					finishReason = "aborted";
					break;
				}
				if (
					beforeAgentStartControl?.appendMessages &&
					beforeAgentStartControl.appendMessages.length > 0
				) {
					this.messages.push(...beforeAgentStartControl.appendMessages);
				}

				// Process one turn
				const turn = await this.processTurn(
					abortSignal,
					beforeAgentStartSystemPrompt,
				);
				const turnEndControl = await this.dispatchLifecycle("hook.turn_end", {
					stage: "turn_end",
					iteration,
					payload: {
						agentId: this.agentId,
						conversationId: this.conversationId,
						parentAgentId: this.parentAgentId,
						iteration,
						turn,
					},
				});
				if (turnEndControl?.cancel) {
					finishReason = "aborted";
					break;
				}

				// Accumulate text and usage
				finalText = turn.text;
				totalUsage.inputTokens += turn.usage.inputTokens;
				totalUsage.outputTokens += turn.usage.outputTokens;
				totalUsage.cacheReadTokens =
					(totalUsage.cacheReadTokens ?? 0) + (turn.usage.cacheReadTokens ?? 0);
				totalUsage.cacheWriteTokens =
					(totalUsage.cacheWriteTokens ?? 0) +
					(turn.usage.cacheWriteTokens ?? 0);
				totalUsage.totalCost =
					(totalUsage.totalCost ?? 0) + (turn.usage.cost ?? 0);

				this.emit({
					type: "usage",
					inputTokens: turn.usage.inputTokens,
					outputTokens: turn.usage.outputTokens,
					cacheReadTokens: turn.usage.cacheReadTokens,
					cacheWriteTokens: turn.usage.cacheWriteTokens,
					cost: turn.usage.cost,
					totalInputTokens: totalUsage.inputTokens,
					totalOutputTokens: totalUsage.outputTokens,
					totalCost: totalUsage.totalCost,
				});

				// If no tool calls, we're done
				if (turn.toolCalls.length === 0) {
					this.emit({
						type: "iteration_end",
						iteration,
						hadToolCalls: false,
						toolCallCount: 0,
					});
					await this.dispatchLifecycle("hook.iteration_end", {
						stage: "iteration_end",
						iteration,
						payload: {
							agentId: this.agentId,
							conversationId: this.conversationId,
							parentAgentId: this.parentAgentId,
							iteration,
							hadToolCalls: false,
							toolCallCount: 0,
						},
					});
					finishReason = "completed";
					break;
				}

				// Execute tool calls
				const context: ToolContext = {
					agentId: this.agentId,
					conversationId: this.conversationId,
					iteration,
					abortSignal,
				};

				// Execute tools in parallel
				let toolCancelRequested = false;
				const toolResults = await executeToolsInParallel(
					this.toolRegistry,
					turn.toolCalls,
					context,
					{
						onToolCallStart: async (call) => {
							this.emit({
								type: "content_start",
								contentType: "tool",
								toolName: call.name,
								toolCallId: call.id,
								input: call.input,
							});
							const mergedControl = await this.dispatchLifecycle(
								"hook.tool_call_before",
								{
									stage: "tool_call_before",
									iteration,
									payload: {
										agentId: this.agentId,
										conversationId: this.conversationId,
										parentAgentId: this.parentAgentId,
										iteration,
										call,
									},
								},
							);
							if (
								mergedControl &&
								Object.hasOwn(mergedControl, "overrideInput")
							) {
								call.input = mergedControl.overrideInput;
							}
							if (mergedControl?.cancel) {
								toolCancelRequested = true;
								this.abortController?.abort();
							}
						},
						onToolCallEnd: async (record) => {
							this.emit({
								type: "content_end",
								contentType: "tool",
								toolName: record.name,
								toolCallId: record.id,
								output: record.output,
								error: record.error,
								durationMs: record.durationMs,
							});
							const mergedControl = await this.dispatchLifecycle(
								"hook.tool_call_after",
								{
									stage: "tool_call_after",
									iteration,
									payload: {
										agentId: this.agentId,
										conversationId: this.conversationId,
										parentAgentId: this.parentAgentId,
										iteration,
										record,
									},
								},
							);
							if (mergedControl?.cancel) {
								toolCancelRequested = true;
							}
						},
					},
					{
						authorize: async (call, toolContext) =>
							this.authorizeToolCall(call, toolContext),
					},
				);

				// Track tool calls
				allToolCalls.push(...toolResults);

				// Build tool result message (with reminder injection after configured iterations)
				const toolResultMessage = this.buildToolResultMessage(
					turn.toolCalls,
					toolResults,
					iteration,
				);
				this.messages.push(toolResultMessage);

				this.emit({
					type: "iteration_end",
					iteration,
					hadToolCalls: true,
					toolCallCount: turn.toolCalls.length,
				});
				await this.dispatchLifecycle("hook.iteration_end", {
					stage: "iteration_end",
					iteration,
					payload: {
						agentId: this.agentId,
						conversationId: this.conversationId,
						parentAgentId: this.parentAgentId,
						iteration,
						hadToolCalls: true,
						toolCallCount: turn.toolCalls.length,
					},
				});
				if (toolCancelRequested) {
					finishReason = "aborted";
					break;
				}
			}
		} catch (error) {
			finishReason = "error";
			const errorObj =
				error instanceof Error ? error : new Error(String(error));
			await this.dispatchLifecycle("hook.error", {
				stage: "error",
				iteration,
				payload: {
					agentId: this.agentId,
					conversationId: this.conversationId,
					parentAgentId: this.parentAgentId,
					iteration,
					error: errorObj,
				},
			});
			this.emit({
				type: "error",
				error: errorObj,
				recoverable: false,
				iteration,
			});
			throw error;
		} finally {
			this.abortController = null;
			this.activeRunId = "";
		}

		const endedAt = new Date();
		const durationMs = endedAt.getTime() - startedAt.getTime();

		// Get model info
		const modelInfo = this.handler.getModel();

		// Emit done event
		this.emit({
			type: "done",
			reason: finishReason,
			text: finalText,
			iterations: iteration,
		});

		const result = {
			text: finalText,
			usage: totalUsage,
			messages: [...this.messages],
			toolCalls: allToolCalls,
			iterations: iteration,
			finishReason,
			model: {
				id: modelInfo.id,
				provider: this.config.providerId,
				info: modelInfo.info,
			},
			startedAt,
			endedAt,
			durationMs,
		};
		await this.dispatchLifecycle("hook.run_end", {
			stage: "run_end",
			iteration,
			payload: {
				agentId: this.agentId,
				conversationId: this.conversationId,
				parentAgentId: this.parentAgentId,
				result,
			},
		});
		await this.hookEngine.shutdown();
		return result;
	}

	/**
	 * Process one turn of the conversation
	 */
	private async processTurn(
		abortSignal: AbortSignal,
		systemPrompt: string,
	): Promise<ProcessedTurn> {
		// Get tool definitions
		const toolDefinitions = toToolDefinitions(this.config.tools);

		// Create the message stream
		const requestMessages = this.messageBuilder.buildForApi(this.messages);
		const stream = this.handler.createMessage(
			systemPrompt,
			requestMessages,
			toolDefinitions,
		);

		// Process the stream
		let text = "";
		let textSignature: string | undefined;
		let reasoning = "";
		let reasoningSignature: string | undefined;
		const redactedReasoningBlocks: string[] = [];
		const toolCalls: PendingToolCall[] = [];
		const usage = {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: undefined as number | undefined,
			cacheWriteTokens: undefined as number | undefined,
			cost: undefined as number | undefined,
		};
		let truncated = false;
		let responseId: string | undefined;

		// Track pending tool calls being streamed
		const pendingToolCallsMap = new Map<
			string,
			{ name?: string; arguments: string; signature?: string }
		>();

		for await (const chunk of stream) {
			// Check for abort
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
					this.processToolCallChunk(chunk, pendingToolCallsMap, toolCalls);
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

		// Add assistant message to history
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

		if (assistantContent.length > 0) {
			this.messages.push({
				role: "assistant",
				content: assistantContent,
			});
		}

		return {
			text,
			reasoning: reasoning || undefined,
			toolCalls,
			usage,
			truncated,
			responseId,
		};
	}

	/**
	 * Process a tool call streaming chunk
	 */
	private processToolCallChunk(
		chunk: providers.ApiStreamChunk & { type: "tool_calls" },
		pendingMap: Map<
			string,
			{ name?: string; arguments: string; signature?: string }
		>,
		toolCalls: PendingToolCall[],
	): void {
		const { tool_call } = chunk;
		const callId =
			tool_call.call_id ?? tool_call.function.id ?? `call_${Date.now()}`;

		// Get or create pending entry
		let pending = pendingMap.get(callId);
		if (!pending) {
			pending = { name: undefined, arguments: "" };
			pendingMap.set(callId, pending);
		}

		// Update name if provided
		if (tool_call.function.name) {
			pending.name = tool_call.function.name;
		}

		// Accumulate arguments
		if (tool_call.function.arguments) {
			if (typeof tool_call.function.arguments === "string") {
				pending.arguments += tool_call.function.arguments;
			} else {
				// Already parsed - serialize it
				pending.arguments = JSON.stringify(tool_call.function.arguments);
			}
		}
		if (chunk.signature) {
			pending.signature = chunk.signature;
		}

		// Check if this is a complete tool call
		if (pending.name && pending.arguments) {
			// Try to parse arguments
			try {
				const input = JSON.parse(pending.arguments);

				// Check if already added
				const existingIndex = toolCalls.findIndex((tc) => tc.id === callId);
				if (existingIndex === -1) {
					toolCalls.push({
						id: callId,
						name: pending.name,
						input,
						signature: pending.signature,
					});
				} else {
					// Update existing
					toolCalls[existingIndex] = {
						id: callId,
						name: pending.name,
						input,
						signature: pending.signature,
					};
				}
			} catch {
				// Arguments not yet complete JSON
			}
		}
	}

	/**
	 * Build a message containing tool results
	 *
	 * After a certain number of iterations (configurable via reminderAfterIterations),
	 * this will prepend a text block reminding the agent to answer if it has enough info.
	 */
	private buildToolResultMessage(
		_calls: PendingToolCall[],
		results: ToolCallRecord[],
		iteration: number,
	): providers.Message {
		const content: providers.ContentBlock[] = [];

		// Add tool results
		for (const result of results) {
			content.push({
				type: "tool_result" as const,
				tool_use_id: result.id,
				content: formatToolResult(result.output, result.error),
				is_error: !!result.error,
			});
		}

		// Keep tool_result blocks first to satisfy providers that require
		// immediate tool_result responses after tool_use.
		if (
			this.config.reminderAfterIterations > 0 &&
			iteration >= this.config.reminderAfterIterations
		) {
			content.push({
				type: "text" as const,
				text: this.config.reminderText,
			});
		}

		return {
			role: "user",
			content,
		};
	}

	private async ensureExtensionsInitialized(): Promise<void> {
		if (this.extensionsInitialized) {
			return;
		}

		try {
			await this.extensionRunner.initialize();
		} catch (error) {
			if (this.config.hookErrorMode === "throw") {
				throw error;
			}
			this.emit({
				type: "error",
				error: error instanceof Error ? error : new Error(String(error)),
				recoverable: true,
				iteration: 0,
			});
		}
		const mergedTools = [
			...this.config.tools,
			...this.extensionRunner.getRegisteredTools(),
		];
		validateTools(mergedTools);
		this.config.tools = mergedTools;
		this.toolRegistry = createToolRegistry(mergedTools);
		this.extensionsInitialized = true;
	}

	private async prepareUserInput(
		userMessage: string,
		mode: "run" | "continue",
	): Promise<{ input: string; cancel: boolean }> {
		const control = await this.dispatchLifecycle("hook.input", {
			stage: "input",
			payload: {
				agentId: this.agentId,
				conversationId: this.conversationId,
				parentAgentId: this.parentAgentId,
				mode,
				input: userMessage,
			},
		});
		const input =
			Object.hasOwn(control ?? {}, "overrideInput") &&
			typeof control?.overrideInput === "string"
				? control.overrideInput
				: userMessage;
		if (control?.cancel) {
			return { input, cancel: true };
		}
		return { input, cancel: false };
	}

	private async buildInitialUserContent(
		userMessage: string,
		userImages?: string[],
		userFiles?: string[],
	): Promise<string | providers.ContentBlock[]> {
		return buildInitialUserContent(userMessage, userImages, userFiles);
	}

	private buildAbortedResult(startedAt: Date, text: string): AgentResult {
		const endedAt = new Date();
		const modelInfo = this.handler.getModel();
		return {
			text,
			usage: {
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				totalCost: 0,
			},
			messages: [...this.messages],
			toolCalls: [],
			iterations: 0,
			finishReason: "aborted",
			model: {
				id: modelInfo.id,
				provider: this.config.providerId,
				info: modelInfo.info,
			},
			startedAt,
			endedAt,
			durationMs: endedAt.getTime() - startedAt.getTime(),
		};
	}

	/**
	 * Emit an event through the callback
	 */
	private emit(event: AgentEvent): void {
		try {
			this.config.onEvent?.(event);
		} catch {
			// Ignore callback errors
		}

		void this.hookEngine
			.dispatch({
				stage: "runtime_event",
				runId: this.activeRunId || this.conversationId,
				agentId: this.agentId,
				conversationId: this.conversationId,
				parentAgentId: this.parentAgentId,
				payload: {
					agentId: this.agentId,
					conversationId: this.conversationId,
					parentAgentId: this.parentAgentId,
					event,
				},
			})
			.catch((error) => {
				this.reportRecoverableError(error);
			});
	}

	private reportRecoverableError(error: unknown): void {
		try {
			this.config.onEvent?.({
				type: "error",
				error: error instanceof Error ? error : new Error(String(error)),
				recoverable: this.config.hookErrorMode !== "throw",
				iteration: 0,
			});
		} catch {
			// Ignore callback errors
		}
	}

	private resolveToolPolicy(toolName: string): ToolPolicy {
		const globalPolicy = this.config.toolPolicies?.["*"] ?? {};
		const toolPolicy = this.config.toolPolicies?.[toolName] ?? {};
		return {
			...globalPolicy,
			...toolPolicy,
		};
	}

	private async requestToolApproval(
		toolName: string,
		toolCallId: string,
		input: unknown,
		context: ToolContext,
		policy: ToolPolicy,
	): Promise<ToolApprovalResult> {
		const callback = this.config.requestToolApproval;
		if (!callback) {
			return {
				approved: false,
				reason: `Tool "${toolName}" requires approval but no approval handler is configured`,
			};
		}
		try {
			const result = await callback({
				agentId: this.agentId,
				conversationId: this.conversationId,
				iteration: context.iteration,
				toolCallId,
				toolName,
				input,
				policy,
			});
			return result;
		} catch (error) {
			return {
				approved: false,
				reason: error instanceof Error ? error.message : String(error),
			};
		}
	}

	private async authorizeToolCall(
		call: PendingToolCall,
		context: ToolContext,
	): Promise<{ allowed: true } | { allowed: false; reason: string }> {
		const policy = this.resolveToolPolicy(call.name);
		const enabled = policy.enabled !== false;
		if (!enabled) {
			return {
				allowed: false,
				reason: `Tool "${call.name}" is disabled by policy`,
			};
		}

		const autoApprove = policy.autoApprove !== false;
		if (autoApprove) {
			return { allowed: true };
		}

		const approval = await this.requestToolApproval(
			call.name,
			call.id,
			call.input,
			context,
			policy,
		);
		if (!approval.approved) {
			return {
				allowed: false,
				reason:
					approval.reason?.trim() || `Tool "${call.name}" was not approved`,
			};
		}
		return { allowed: true };
	}

	private appendHookContext(source: string, context: string): void {
		const trimmed = context.trim();
		if (!trimmed) {
			return;
		}

		const text = trimmed.startsWith("<hook_context")
			? trimmed
			: `<hook_context source="${source}">\n${trimmed}\n</hook_context>`;

		this.messages.push({
			role: "user",
			content: [
				{
					type: "text",
					text,
				},
			],
		});
	}

	/**
	 * Merge multiple abort signals into one
	 */
	private mergeAbortSignals(
		...signals: (AbortSignal | undefined)[]
	): AbortSignal {
		const activeSignals = signals.filter(
			(signal): signal is AbortSignal => !!signal,
		);
		if (activeSignals.length === 0) {
			return new AbortController().signal;
		}
		if (activeSignals.length === 1) {
			return activeSignals[0];
		}

		const abortSignalCtor = AbortSignal as unknown as {
			any?: (signals: AbortSignal[]) => AbortSignal;
		};
		if (abortSignalCtor.any) {
			return abortSignalCtor.any(activeSignals);
		}

		const controller = new AbortController();

		for (const signal of activeSignals) {
			if (signal.aborted) {
				controller.abort();
				break;
			}
			signal.addEventListener("abort", () => controller.abort(), {
				once: true,
			});
		}

		return controller.signal;
	}
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new Agent instance
 *
 * This is a convenience function that creates an Agent with the given config.
 *
 * @example
 * ```typescript
 * const agent = createAgent({
 *   providerId: "anthropic",
 *   modelId: "claude-sonnet-4-5-20250929"
 *   systemPrompt: "You are helpful.",
 *   tools: [],
 * })
 * ```
 */
export function createAgent(config: AgentConfig): Agent {
	return new Agent(config);
}
