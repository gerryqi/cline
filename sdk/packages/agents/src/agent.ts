/**
 * Agent Class
 *
 * The main class for building and running agentic loops with LLMs.
 */

import { providers } from "@clinebot/llms";
import { buildInitialUserContent } from "./agent-input.js";
import {
	type ContributionRegistry,
	createContributionRegistry,
} from "./extensions.js";
import { HookEngine, registerLifecycleHandlers } from "./hooks/index.js";
import { MessageBuilder } from "./message-builder.js";
import { createAgentRuntimeBus } from "./runtime/agent-runtime-bus.js";
import { ConversationStore } from "./runtime/conversation-store.js";
import { LifecycleOrchestrator } from "./runtime/lifecycle-orchestrator.js";
import { ToolOrchestrator } from "./runtime/tool-orchestrator.js";
import { TurnProcessor } from "./runtime/turn-processor.js";
import { createToolRegistry, validateTools } from "./tools/index.js";
import type {
	AgentConfig,
	AgentEvent,
	AgentExtensionRegistry,
	AgentFinishReason,
	AgentResult,
	AgentUsage,
	BasicLogger,
	PendingToolCall,
	Tool,
	ToolApprovalResult,
	ToolCallRecord,
	ToolContext,
	ToolPolicy,
} from "./types.js";

const DEFAULT_REMINDER_TEXT =
	"REMINDER: If you have gathered enough information to answer the user's question, please provide your final answer now without using any more tools.";

function resolveKnownModelsFromConfig(
	config: AgentConfig,
): Record<string, providers.ModelInfo> | undefined {
	if (config.providerConfig?.knownModels) {
		return config.providerConfig.knownModels;
	}
	if (config.knownModels) {
		return config.knownModels;
	}

	try {
		const providerConfig = providers.toProviderConfig({
			provider: config.providerId,
			model: config.modelId,
			apiKey: config.apiKey,
			baseUrl: config.baseUrl,
			headers: config.headers,
		});
		return providerConfig.knownModels;
	} catch {
		return undefined;
	}
}

export class Agent {
	private config: Required<
		Pick<
			AgentConfig,
			| "providerId"
			| "modelId"
			| "systemPrompt"
			| "tools"
			| "maxParallelToolCalls"
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
	private abortController: AbortController | null = null;
	private contributionRegistry: ContributionRegistry;
	private readonly hookEngine: HookEngine;
	private messageBuilder: MessageBuilder;
	private readonly logger?: BasicLogger;
	private extensionsInitialized = false;
	private activeRunId = "";
	private runState: "idle" | "running" | "shutting_down" = "idle";
	private readonly runtimeBus = createAgentRuntimeBus();
	private readonly conversationStore: ConversationStore;
	private readonly lifecycle: LifecycleOrchestrator;
	private turnProcessor: TurnProcessor;
	private readonly toolOrchestrator: ToolOrchestrator;
	private readonly agentId: string;
	private readonly parentAgentId: string | null;

	constructor(config: AgentConfig) {
		this.config = {
			...config,
			maxIterations: config.maxIterations,
			maxParallelToolCalls: config.maxParallelToolCalls ?? 8,
			apiTimeoutMs: config.apiTimeoutMs ?? 120000,
			maxTokensPerTurn: config.maxTokensPerTurn ?? 8192,
			reminderAfterIterations: config.reminderAfterIterations ?? 50,
			reminderText: config.reminderText ?? DEFAULT_REMINDER_TEXT,
			hookErrorMode: config.hookErrorMode ?? "ignore",
			extensions: config.extensions ?? [],
			toolPolicies: config.toolPolicies ?? {},
		};

		this.agentId = `agent_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
		this.parentAgentId = config.parentAgentId ?? null;
		this.conversationStore = new ConversationStore(
			config.initialMessages ?? [],
		);
		this.logger = config.logger;

		this.contributionRegistry = createContributionRegistry({
			extensions: this.config.extensions,
		});
		this.contributionRegistry.resolve();
		this.contributionRegistry.validate();

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

		registerLifecycleHandlers(this.hookEngine, {
			...this.config,
			extensions: this.contributionRegistry.getValidatedExtensions(),
		});

		this.messageBuilder = new MessageBuilder();
		this.toolRegistry = createToolRegistry([]);
		this.handler = this.createHandlerFromConfig(this.config);
		this.turnProcessor = new TurnProcessor({
			handler: this.handler,
			messageBuilder: this.messageBuilder,
			emit: (event) => this.emit(event),
		});
		this.lifecycle = new LifecycleOrchestrator({
			hookEngine: this.hookEngine,
			runtimeBus: this.runtimeBus,
			getRunId: () =>
				this.activeRunId || this.conversationStore.getConversationId(),
			getAgentId: () => this.agentId,
			getConversationId: () => this.conversationStore.getConversationId(),
			getParentAgentId: () => this.parentAgentId,
			onHookContext: (source, context) =>
				this.appendHookContext(source, context),
			onDispatchError: (error) => this.reportRecoverableError(error),
		});
		this.toolOrchestrator = new ToolOrchestrator({
			getAgentId: () => this.agentId,
			getConversationId: () => this.conversationStore.getConversationId(),
			getParentAgentId: () => this.parentAgentId,
			emit: (event) => this.emit(event),
			dispatchLifecycle: ({ source, iteration, stage, payload }) =>
				this.lifecycle.dispatch(source, {
					stage,
					iteration,
					payload,
				}),
			authorizeToolCall: (call, context) =>
				this.authorizeToolCall(call, context),
			onCancelRequested: () => {
				this.abortController?.abort();
			},
			onLog: (level, message, metadata) => {
				this.log(level, message, metadata);
			},
		});

		// onEvent callback and runtime hooks are both runtime-bus subscribers.
		this.runtimeBus.subscribeRuntimeEvent((event) => {
			try {
				this.config.onEvent?.(event);
			} catch {
				// Ignore callback errors
			}
		});
		this.runtimeBus.subscribeRuntimeEvent((event) => {
			this.lifecycle.dispatchRuntimeEvent(event);
		});
	}

	async run(
		userMessage: string,
		userImages?: string[],
		userFiles?: string[],
	): Promise<AgentResult> {
		this.assertCanStartRun();
		this.log("info", "Agent run requested", {
			agentId: this.agentId,
			conversationId: this.conversationStore.getConversationId(),
			messageLength: userMessage.length,
		});
		await this.ensureExtensionsInitialized();

		this.conversationStore.resetForRun();

		const preparedInput = await this.prepareUserInput(userMessage, "run");
		if (preparedInput.cancel) {
			return this.buildAbortedResult(new Date(), "");
		}

		this.conversationStore.appendMessage({
			role: "user",
			content: await this.buildInitialUserContent(
				preparedInput.input,
				userImages,
				userFiles,
			),
		});

		return this.executeLoop(preparedInput.input);
	}

	async continue(
		userMessage: string,
		userImages?: string[],
		userFiles?: string[],
	): Promise<AgentResult> {
		this.assertCanStartRun();
		this.log("info", "Agent continue requested", {
			agentId: this.agentId,
			conversationId: this.conversationStore.getConversationId(),
			messageLength: userMessage.length,
		});
		await this.ensureExtensionsInitialized();

		const preparedInput = await this.prepareUserInput(userMessage, "continue");
		if (preparedInput.cancel) {
			return this.buildAbortedResult(new Date(), "");
		}

		this.conversationStore.appendMessage({
			role: "user",
			content: await this.buildInitialUserContent(
				preparedInput.input,
				userImages,
				userFiles,
			),
		});

		return this.executeLoop(preparedInput.input);
	}

	getMessages(): providers.Message[] {
		return this.conversationStore.getMessages();
	}

	clearHistory(): void {
		this.conversationStore.clearHistory();
	}

	restore(messages: providers.Message[]): void {
		this.conversationStore.restore(messages);
	}

	abort(): void {
		this.abortController?.abort();
	}

	subscribeEvents(listener: (event: AgentEvent) => void): () => void {
		return this.runtimeBus.subscribeRuntimeEvent(listener);
	}

	async shutdown(reason?: string): Promise<void> {
		if (this.runState === "running") {
			throw new Error("Cannot shutdown agent while a run is in progress");
		}
		if (this.runState === "shutting_down") {
			return;
		}
		this.runState = "shutting_down";
		try {
			await this.lifecycle.dispatch("hook.session_shutdown", {
				stage: "session_shutdown",
				payload: {
					agentId: this.agentId,
					conversationId: this.conversationStore.getConversationId(),
					parentAgentId: this.parentAgentId,
					reason,
				},
			});
			await this.lifecycle.shutdown();
		} finally {
			this.runState = "idle";
		}
	}

	getExtensionRegistry(): AgentExtensionRegistry {
		return this.contributionRegistry.getRegistrySnapshot();
	}

	getAgentId(): string {
		return this.agentId;
	}

	getConversationId(): string {
		return this.conversationStore.getConversationId();
	}

	updateConnection(
		overrides: Partial<
			Pick<
				AgentConfig,
				| "providerId"
				| "modelId"
				| "apiKey"
				| "baseUrl"
				| "headers"
				| "knownModels"
				| "reasoningEffort"
				| "thinkingBudgetTokens"
				| "thinking"
				| "abortSignal"
			>
		>,
	): void {
		this.config = {
			...this.config,
			...overrides,
		};
		this.handler = this.createHandlerFromConfig(this.config);
		this.turnProcessor = new TurnProcessor({
			handler: this.handler,
			messageBuilder: this.messageBuilder,
			emit: (event) => this.emit(event),
		});
	}

	private assertCanStartRun(): void {
		if (this.runState === "running") {
			throw new Error(
				"Cannot start a new run while another run is already in progress",
			);
		}
		if (this.runState === "shutting_down") {
			throw new Error("Cannot start a run while agent is shutting down");
		}
	}

	private createHandlerFromConfig(config: AgentConfig): providers.ApiHandler {
		const baseProviderConfig =
			config.providerConfig?.providerId === config.providerId
				? config.providerConfig
				: undefined;
		const normalizedProviderConfig: providers.ProviderConfig = {
			...(baseProviderConfig ?? {}),
			providerId: config.providerId,
			modelId: config.modelId,
			apiKey: config.apiKey ?? baseProviderConfig?.apiKey,
			baseUrl: config.baseUrl ?? baseProviderConfig?.baseUrl,
			headers: config.headers ?? baseProviderConfig?.headers,
			knownModels: resolveKnownModelsFromConfig(config),
			maxOutputTokens: config.maxTokensPerTurn,
			reasoningEffort: config.reasoningEffort,
			thinkingBudgetTokens: config.thinkingBudgetTokens,
			thinking: config.thinking,
			abortSignal: config.abortSignal,
		};
		return providers.createHandler(normalizedProviderConfig);
	}

	private async executeLoop(triggerMessage: string): Promise<AgentResult> {
		if (this.runState !== "idle") {
			throw new Error(
				`Cannot start agent run while state is "${this.runState}"`,
			);
		}
		this.runState = "running";
		const startedAt = new Date();
		const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
		this.activeRunId = runId;
		this.abortController = new AbortController();
		this.log("info", "Agent loop started", {
			agentId: this.agentId,
			conversationId: this.conversationStore.getConversationId(),
			runId,
			triggerLength: triggerMessage.length,
		});

		const abortSignal = this.mergeAbortSignals(
			this.config.abortSignal,
			this.abortController.signal,
		);

		let iteration = 0;
		let finishReason: AgentFinishReason = "completed";
		let finalText = "";
		const allToolCalls: ToolCallRecord[] = [];
		const totalUsage: AgentUsage = {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalCost: undefined,
		};

		try {
			if (!this.conversationStore.isSessionStarted()) {
				const sessionStartControl = await this.lifecycle.dispatch(
					"hook.session_start",
					{
						stage: "session_start",
						payload: {
							agentId: this.agentId,
							conversationId: this.conversationStore.getConversationId(),
							parentAgentId: this.parentAgentId,
							schedule: this.config.schedule,
						},
					},
				);
				if (sessionStartControl?.cancel) {
					finishReason = "aborted";
				}
				this.conversationStore.markSessionStarted();
			}

			const runStartControl = await this.lifecycle.dispatch("hook.run_start", {
				stage: "run_start",
				payload: {
					agentId: this.agentId,
					conversationId: this.conversationStore.getConversationId(),
					parentAgentId: this.parentAgentId,
					userMessage: triggerMessage,
				},
			});
			if (runStartControl?.cancel) {
				finishReason = "aborted";
			}

			while (finishReason !== "aborted") {
				if (
					this.config.maxIterations !== undefined &&
					iteration >= this.config.maxIterations
				) {
					finishReason = "max_iterations";
					break;
				}
				if (abortSignal.aborted) {
					finishReason = "aborted";
					break;
				}

				iteration++;
				this.log("debug", "Agent iteration started", {
					agentId: this.agentId,
					conversationId: this.conversationStore.getConversationId(),
					runId,
					iteration,
				});

				const iterationStartControl = await this.lifecycle.dispatch(
					"hook.iteration_start",
					{
						stage: "iteration_start",
						iteration,
						payload: {
							agentId: this.agentId,
							conversationId: this.conversationStore.getConversationId(),
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

				const turnStartControl = await this.lifecycle.dispatch(
					"hook.turn_start",
					{
						stage: "turn_start",
						iteration,
						payload: {
							agentId: this.agentId,
							conversationId: this.conversationStore.getConversationId(),
							parentAgentId: this.parentAgentId,
							iteration,
							messages: this.conversationStore.getMessages(),
						},
					},
				);
				if (turnStartControl?.cancel) {
					finishReason = "aborted";
					break;
				}

				const beforeAgentStartControl = await this.lifecycle.dispatch(
					"hook.before_agent_start",
					{
						stage: "before_agent_start",
						iteration,
						payload: {
							agentId: this.agentId,
							conversationId: this.conversationStore.getConversationId(),
							parentAgentId: this.parentAgentId,
							iteration,
							systemPrompt: this.config.systemPrompt,
							messages: this.conversationStore.getMessages(),
						},
					},
				);
				const turnSystemPrompt =
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
					this.conversationStore.appendMessages(
						beforeAgentStartControl.appendMessages,
					);
				}

				const { turn, assistantMessage } = await this.turnProcessor.processTurn(
					this.conversationStore.getMessages(),
					turnSystemPrompt,
					this.config.tools,
					abortSignal,
				);
				if (assistantMessage) {
					this.conversationStore.appendMessage(assistantMessage);
				}

				const turnEndControl = await this.lifecycle.dispatch("hook.turn_end", {
					stage: "turn_end",
					iteration,
					payload: {
						agentId: this.agentId,
						conversationId: this.conversationStore.getConversationId(),
						parentAgentId: this.parentAgentId,
						iteration,
						turn,
					},
				});
				if (turnEndControl?.cancel) {
					finishReason = "aborted";
					break;
				}

				finalText = turn.text;
				totalUsage.inputTokens += turn.usage.inputTokens;
				totalUsage.outputTokens += turn.usage.outputTokens;
				totalUsage.cacheReadTokens =
					(totalUsage.cacheReadTokens ?? 0) + (turn.usage.cacheReadTokens ?? 0);
				totalUsage.cacheWriteTokens =
					(totalUsage.cacheWriteTokens ?? 0) +
					(turn.usage.cacheWriteTokens ?? 0);
				if (typeof turn.usage.cost === "number") {
					totalUsage.totalCost = (totalUsage.totalCost ?? 0) + turn.usage.cost;
				}

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

				if (turn.toolCalls.length === 0) {
					// Check completion guard before allowing the loop to end.
					// If the guard returns a nudge string, inject it and continue.
					const guardNudge = this.config.completionGuard?.();
					if (guardNudge) {
						this.log("info", "Completion guard prevented early exit", {
							agentId: this.agentId,
							conversationId: this.conversationStore.getConversationId(),
							runId,
							iteration,
						});
						this.conversationStore.appendMessage({
							role: "user",
							content: [{ type: "text", text: guardNudge }],
						});
						continue;
					}

					this.emit({
						type: "iteration_end",
						iteration,
						hadToolCalls: false,
						toolCallCount: 0,
					});
					await this.lifecycle.dispatch("hook.iteration_end", {
						stage: "iteration_end",
						iteration,
						payload: {
							agentId: this.agentId,
							conversationId: this.conversationStore.getConversationId(),
							parentAgentId: this.parentAgentId,
							iteration,
							hadToolCalls: false,
							toolCallCount: 0,
						},
					});
					finishReason = "completed";
					break;
				}

				const context: ToolContext = {
					agentId: this.agentId,
					conversationId: this.conversationStore.getConversationId(),
					iteration,
					abortSignal,
				};
				const { results: toolResults, cancelRequested } =
					await this.toolOrchestrator.execute(
						this.toolRegistry,
						turn.toolCalls,
						context,
						{ iteration, runId },
						{ maxConcurrency: this.config.maxParallelToolCalls },
					);

				allToolCalls.push(...toolResults);
				this.conversationStore.appendMessage(
					this.toolOrchestrator.buildToolResultMessage(toolResults, iteration, {
						afterIterations: this.config.reminderAfterIterations,
						text: this.config.reminderText,
					}),
				);

				this.emit({
					type: "iteration_end",
					iteration,
					hadToolCalls: true,
					toolCallCount: turn.toolCalls.length,
				});
				await this.lifecycle.dispatch("hook.iteration_end", {
					stage: "iteration_end",
					iteration,
					payload: {
						agentId: this.agentId,
						conversationId: this.conversationStore.getConversationId(),
						parentAgentId: this.parentAgentId,
						iteration,
						hadToolCalls: true,
						toolCallCount: turn.toolCalls.length,
					},
				});
				if (cancelRequested) {
					this.log("warn", "Agent iteration cancelled by tool lifecycle", {
						agentId: this.agentId,
						conversationId: this.conversationStore.getConversationId(),
						runId,
						iteration,
					});
					finishReason = "aborted";
					break;
				}
				this.log("debug", "Agent iteration finished", {
					agentId: this.agentId,
					conversationId: this.conversationStore.getConversationId(),
					runId,
					iteration,
					toolCalls: turn.toolCalls.length,
				});
			}
		} catch (error) {
			finishReason = "error";
			this.log("error", "Agent loop failed", {
				agentId: this.agentId,
				conversationId: this.conversationStore.getConversationId(),
				runId,
				error,
			});
			const errorObj =
				error instanceof Error ? error : new Error(String(error));
			await this.lifecycle.dispatch("hook.error", {
				stage: "error",
				iteration,
				payload: {
					agentId: this.agentId,
					conversationId: this.conversationStore.getConversationId(),
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
			if (this.runState === "running") {
				this.runState = "idle";
			}
		}

		const endedAt = new Date();
		const durationMs = endedAt.getTime() - startedAt.getTime();
		const modelInfo = this.handler.getModel();

		this.emit({
			type: "done",
			reason: finishReason,
			text: finalText,
			iterations: iteration,
		});
		this.log("info", "Agent loop finished", {
			agentId: this.agentId,
			conversationId: this.conversationStore.getConversationId(),
			runId,
			finishReason,
			iterations: iteration,
			durationMs,
		});

		const result = {
			text: finalText,
			usage: totalUsage,
			messages: this.conversationStore.getMessages(),
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
		await this.lifecycle.dispatch("hook.run_end", {
			stage: "run_end",
			iteration,
			payload: {
				agentId: this.agentId,
				conversationId: this.conversationStore.getConversationId(),
				parentAgentId: this.parentAgentId,
				result,
			},
		});
		await this.lifecycle.shutdown();
		return result;
	}

	private async ensureExtensionsInitialized(): Promise<void> {
		if (this.extensionsInitialized) {
			return;
		}

		try {
			await this.contributionRegistry.initialize();
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
			...this.contributionRegistry.getRegisteredTools(),
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
		const control = await this.lifecycle.dispatch("hook.input", {
			stage: "input",
			payload: {
				agentId: this.agentId,
				conversationId: this.conversationStore.getConversationId(),
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
		return buildInitialUserContent(
			userMessage,
			userImages,
			userFiles,
			this.config.userFileContentLoader,
		);
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
				totalCost: undefined,
			},
			messages: this.conversationStore.getMessages(),
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

	private emit(event: AgentEvent): void {
		this.runtimeBus.emitRuntimeEvent(event);
	}

	private reportRecoverableError(error: unknown): void {
		this.log("warn", "Recoverable agent error", {
			agentId: this.agentId,
			conversationId: this.conversationStore.getConversationId(),
			runId: this.activeRunId || this.conversationStore.getConversationId(),
			error,
		});
		this.emit({
			type: "error",
			error: error instanceof Error ? error : new Error(String(error)),
			recoverable: this.config.hookErrorMode !== "throw",
			iteration: 0,
		});
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
				conversationId: this.conversationStore.getConversationId(),
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

		const autoApprove = policy.autoApprove !== false && call.review !== true;
		if (autoApprove) {
			return { allowed: true };
		}

		const approval = await this.requestToolApproval(
			call.name,
			call.id,
			call.input,
			context,
			call.review === true ? { ...policy, autoApprove: false } : policy,
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

		this.conversationStore.appendMessage({
			role: "user",
			content: [
				{
					type: "text",
					text,
				},
			],
		});
	}

	private log(
		level: "debug" | "info" | "warn" | "error",
		message: string,
		metadata?: Record<string, unknown>,
	): void {
		const sink = this.logger?.[level];
		if (!sink) {
			return;
		}
		try {
			if (level === "error") {
				const errorMeta =
					metadata?.error instanceof Error
						? {
								...metadata,
								error: {
									name: metadata.error.name,
									message: metadata.error.message,
									stack: metadata.error.stack,
								},
							}
						: metadata;
				sink(message, errorMeta);
				return;
			}
			sink(message, metadata);
		} catch {
			// Logging failures must never break agent execution.
		}
	}

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

export function createAgent(config: AgentConfig): Agent {
	return new Agent(config);
}
