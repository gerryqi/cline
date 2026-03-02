/**
 * Multi-Agent Coordination
 *
 * Utilities for orchestrating multiple agents working together.
 */

import { type Agent, createAgent } from "../agent.js";
import type { AgentConfig, AgentEvent, AgentResult } from "../types.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Configuration for a team member agent
 */
export interface TeamMemberConfig extends AgentConfig {
	/** Optional role description for this agent */
	role?: string;
}

/**
 * Task to execute on a specific agent
 */
export interface AgentTask {
	/** ID of the agent to run the task */
	agentId: string;
	/** Message to send to the agent */
	message: string;
	/** Optional metadata for the task */
	metadata?: Record<string, unknown>;
}

/**
 * Result from a task execution
 */
export interface TaskResult {
	/** ID of the agent that executed the task */
	agentId: string;
	/** The agent result */
	result: AgentResult;
	/** Any error that occurred */
	error?: Error;
	/** Task metadata */
	metadata?: Record<string, unknown>;
}

export enum TeamMessageType {
	TaskStart = "task_start",
	TaskEnd = "task_end",
	AgentEvent = "agent_event",
	TeammateSpawned = "teammate_spawned",
	TeammateShutdown = "teammate_shutdown",
	TeamTaskUpdated = "team_task_updated",
	TeamMessage = "team_message",
	TeamMissionLog = "team_mission_log",
	TeamTaskCompleted = "team_task_completed",
}

/**
 * Event emitted during team execution
 */
export type TeamEvent =
	| { type: TeamMessageType.TaskStart; agentId: string; message: string }
	| {
			type: TeamMessageType.TaskEnd;
			agentId: string;
			result?: AgentResult;
			error?: Error;
	  }
	| { type: TeamMessageType.AgentEvent; agentId: string; event: AgentEvent }
	| { type: TeamMessageType.TeammateSpawned; agentId: string; role?: string }
	| { type: TeamMessageType.TeammateShutdown; agentId: string; reason?: string }
	| { type: TeamMessageType.TeamTaskUpdated; task: TeamTask }
	| { type: TeamMessageType.TeamMessage; message: TeamMailboxMessage }
	| { type: TeamMessageType.TeamMissionLog; entry: MissionLogEntry };

// =============================================================================
// AgentTeam
// =============================================================================

/**
 * A team of agents that can work together
 *
 * @example
 * ```typescript
 * const team = createAgentTeam({
 *   coder: {
 *     providerId: "anthropic",
 *     modelId: "claude-sonnet-4-20250514",
 *     systemPrompt: "You are a coding expert.",
 *     tools: [readFile, writeFile],
 *   },
 *   reviewer: {
 *     providerId: "openai",
 *     modelId: "gpt-4o",
 *     systemPrompt: "You are a code reviewer.",
 *     tools: [readFile],
 *   }
 * })
 *
 * const result = await team.routeTo("coder", "Write a function")
 * ```
 */
export class AgentTeam {
	private agents: Map<string, Agent> = new Map();
	private configs: Map<string, TeamMemberConfig> = new Map();
	private onTeamEvent?: (event: TeamEvent) => void;

	constructor(
		configs?: Record<string, TeamMemberConfig>,
		onTeamEvent?: (event: TeamEvent) => void,
	) {
		this.onTeamEvent = onTeamEvent;

		if (configs) {
			for (const [id, config] of Object.entries(configs)) {
				this.addAgent(id, config);
			}
		}
	}

	/**
	 * Add an agent to the team
	 *
	 * @param id - Unique identifier for the agent
	 * @param config - Agent configuration
	 */
	addAgent(id: string, config: TeamMemberConfig): void {
		if (this.agents.has(id)) {
			throw new Error(`Agent with id "${id}" already exists in the team`);
		}

		// Wrap onEvent to emit team events
		const wrappedConfig: AgentConfig = {
			...config,
			onEvent: (event: AgentEvent) => {
				config.onEvent?.(event);
				this.emitEvent({
					type: TeamMessageType.AgentEvent,
					agentId: id,
					event,
				});
			},
		};

		const agent = createAgent(wrappedConfig);
		this.agents.set(id, agent);
		this.configs.set(id, config);
	}

	/**
	 * Remove an agent from the team
	 */
	removeAgent(id: string): boolean {
		this.configs.delete(id);
		return this.agents.delete(id);
	}

	/**
	 * Get an agent by ID
	 */
	getAgent(id: string): Agent | undefined {
		return this.agents.get(id);
	}

	/**
	 * Get all agent IDs in the team
	 */
	getAgentIds(): string[] {
		return Array.from(this.agents.keys());
	}

	/**
	 * Get the number of agents in the team
	 */
	get size(): number {
		return this.agents.size;
	}

	/**
	 * Route a message to a specific agent
	 *
	 * @param agentId - ID of the agent to send the message to
	 * @param message - The message to send
	 * @returns The agent result
	 */
	async routeTo(agentId: string, message: string): Promise<AgentResult> {
		const agent = this.agents.get(agentId);
		if (!agent) {
			throw new Error(`Agent "${agentId}" not found in team`);
		}

		this.emitEvent({ type: TeamMessageType.TaskStart, agentId, message });

		try {
			const result = await agent.run(message);
			this.emitEvent({ type: TeamMessageType.TaskEnd, agentId, result });
			return result;
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error));
			this.emitEvent({ type: TeamMessageType.TaskEnd, agentId, error: err });
			throw error;
		}
	}

	/**
	 * Continue a conversation with a specific agent
	 *
	 * @param agentId - ID of the agent to continue with
	 * @param message - The message to send
	 * @returns The agent result
	 */
	async continueTo(agentId: string, message: string): Promise<AgentResult> {
		const agent = this.agents.get(agentId);
		if (!agent) {
			throw new Error(`Agent "${agentId}" not found in team`);
		}

		this.emitEvent({ type: TeamMessageType.TaskStart, agentId, message });

		try {
			const result = await agent.continue(message);
			this.emitEvent({ type: TeamMessageType.TaskEnd, agentId, result });
			return result;
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error));
			this.emitEvent({ type: TeamMessageType.TaskEnd, agentId, error: err });
			throw error;
		}
	}

	/**
	 * Run multiple tasks in parallel across different agents
	 *
	 * @param tasks - Array of tasks to execute
	 * @returns Array of task results in the same order
	 *
	 * @example
	 * ```typescript
	 * const results = await team.runParallel([
	 *   { agentId: "coder", message: "Implement feature X" },
	 *   { agentId: "reviewer", message: "Review the code" },
	 * ])
	 * ```
	 */
	async runParallel(tasks: AgentTask[]): Promise<TaskResult[]> {
		const executions = tasks.map(async (task): Promise<TaskResult> => {
			const agent = this.agents.get(task.agentId);
			if (!agent) {
				return {
					agentId: task.agentId,
					result: undefined as unknown as AgentResult,
					error: new Error(`Agent "${task.agentId}" not found in team`),
					metadata: task.metadata,
				};
			}

			this.emitEvent({
				type: TeamMessageType.TaskStart,
				agentId: task.agentId,
				message: task.message,
			});

			try {
				const result = await agent.run(task.message);
				this.emitEvent({
					type: TeamMessageType.TaskEnd,
					agentId: task.agentId,
					result,
				});
				return {
					agentId: task.agentId,
					result,
					metadata: task.metadata,
				};
			} catch (error) {
				const err = error instanceof Error ? error : new Error(String(error));
				this.emitEvent({
					type: TeamMessageType.TaskEnd,
					agentId: task.agentId,
					error: err,
				});
				return {
					agentId: task.agentId,
					result: undefined as unknown as AgentResult,
					error: err,
					metadata: task.metadata,
				};
			}
		});

		return Promise.all(executions);
	}

	/**
	 * Run tasks sequentially across agents
	 *
	 * Tasks are executed in order, and the result of each task is available
	 * to the next task via the context parameter.
	 *
	 * @param tasks - Array of tasks to execute in order
	 * @returns Array of task results in the same order
	 */
	async runSequential(tasks: AgentTask[]): Promise<TaskResult[]> {
		const results: TaskResult[] = [];

		for (const task of tasks) {
			const agent = this.agents.get(task.agentId);
			if (!agent) {
				results.push({
					agentId: task.agentId,
					result: undefined as unknown as AgentResult,
					error: new Error(`Agent "${task.agentId}" not found in team`),
					metadata: task.metadata,
				});
				continue;
			}

			this.emitEvent({
				type: TeamMessageType.TaskStart,
				agentId: task.agentId,
				message: task.message,
			});

			try {
				const result = await agent.run(task.message);
				this.emitEvent({
					type: TeamMessageType.TaskEnd,
					agentId: task.agentId,
					result,
				});
				results.push({
					agentId: task.agentId,
					result,
					metadata: task.metadata,
				});
			} catch (error) {
				const err = error instanceof Error ? error : new Error(String(error));
				this.emitEvent({
					type: TeamMessageType.TaskEnd,
					agentId: task.agentId,
					error: err,
				});
				results.push({
					agentId: task.agentId,
					result: undefined as unknown as AgentResult,
					error: err,
					metadata: task.metadata,
				});
			}
		}

		return results;
	}

	/**
	 * Run a pipeline of agents where output from one becomes input to the next
	 *
	 * @param pipeline - Array of agent IDs in pipeline order
	 * @param initialMessage - The starting message
	 * @param messageTransformer - Optional function to transform output to input
	 * @returns Array of all results from the pipeline
	 *
	 * @example
	 * ```typescript
	 * const results = await team.runPipeline(
	 *   ["planner", "coder", "reviewer"],
	 *   "Create a REST API for user management",
	 *   (prevResult, agentId) => {
	 *     if (agentId === "coder") {
	 *       return `Implement this plan:\n${prevResult.text}`
	 *     }
	 *     return `Review this code:\n${prevResult.text}`
	 *   }
	 * )
	 * ```
	 */
	async runPipeline(
		pipeline: string[],
		initialMessage: string,
		messageTransformer?: (
			prevResult: AgentResult,
			nextAgentId: string,
		) => string,
	): Promise<TaskResult[]> {
		const results: TaskResult[] = [];
		let currentMessage = initialMessage;

		for (const agentId of pipeline) {
			const agent = this.agents.get(agentId);
			if (!agent) {
				results.push({
					agentId,
					result: undefined as unknown as AgentResult,
					error: new Error(`Agent "${agentId}" not found in team`),
				});
				break; // Pipeline stops on missing agent
			}

			this.emitEvent({
				type: TeamMessageType.TaskStart,
				agentId,
				message: currentMessage,
			});

			try {
				const result = await agent.run(currentMessage);
				this.emitEvent({ type: TeamMessageType.TaskEnd, agentId, result });
				results.push({ agentId, result });

				// Transform for next agent if not the last one
				const nextIndex = pipeline.indexOf(agentId) + 1;
				if (nextIndex < pipeline.length) {
					const nextAgentId = pipeline[nextIndex];
					currentMessage = messageTransformer
						? messageTransformer(result, nextAgentId)
						: `Previous agent output:\n${result.text}\n\nPlease continue from here.`;
				}
			} catch (error) {
				const err = error instanceof Error ? error : new Error(String(error));
				this.emitEvent({ type: TeamMessageType.TaskEnd, agentId, error: err });
				results.push({
					agentId,
					result: undefined as unknown as AgentResult,
					error: err,
				});
				break; // Pipeline stops on error
			}
		}

		return results;
	}

	/**
	 * Abort all running agents
	 */
	abortAll(): void {
		for (const agent of this.agents.values()) {
			agent.abort();
		}
	}

	/**
	 * Clear all agents from the team
	 */
	clear(): void {
		this.abortAll();
		this.agents.clear();
		this.configs.clear();
	}

	private emitEvent(event: TeamEvent): void {
		try {
			this.onTeamEvent?.(event);
		} catch {
			// Ignore callback errors
		}
	}
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a new agent team
 *
 * @param configs - Map of agent ID to configuration
 * @param onTeamEvent - Optional callback for team events
 * @returns A new AgentTeam instance
 *
 * @example
 * ```typescript
 * const team = createAgentTeam({
 *   coder: {
 *     providerId: "anthropic",
 *     modelId: "claude-sonnet-4-20250514",
 *     systemPrompt: "You are a coding expert.",
 *     tools: [readFile, writeFile],
 *   },
 *   reviewer: {
 *     providerId: "anthropic",
 *     modelId: "claude-sonnet-4-20250514",
 *     systemPrompt: "You are a code reviewer.",
 *     tools: [readFile],
 *   }
 * })
 * ```
 */
export function createAgentTeam(
	configs: Record<string, TeamMemberConfig>,
	onTeamEvent?: (event: TeamEvent) => void,
): AgentTeam {
	return new AgentTeam(configs, onTeamEvent);
}

// =============================================================================
// Specialized Teams
// =============================================================================

/**
 * Create a simple two-agent team with a worker and reviewer
 *
 * @example
 * ```typescript
 * const team = createWorkerReviewerTeam({
 *   worker: {
 *     providerId: "anthropic",
 *     modelId: "claude-sonnet-4-20250514",
 *     systemPrompt: "You are a coding expert.",
 *     tools: [...],
 *   },
 *   reviewer: {
 *     providerId: "anthropic",
 *     modelId: "claude-sonnet-4-20250514",
 *     systemPrompt: "You review code for issues.",
 *     tools: [...],
 *   }
 * })
 *
 * const result = await team.doAndReview("Implement feature X")
 * ```
 */
export function createWorkerReviewerTeam(configs: {
	worker: TeamMemberConfig;
	reviewer: TeamMemberConfig;
}): AgentTeam & {
	doAndReview: (
		message: string,
	) => Promise<{ workerResult: AgentResult; reviewResult: AgentResult }>;
} {
	const team = createAgentTeam({
		worker: configs.worker,
		reviewer: configs.reviewer,
	});

	// Add specialized method
	const enhanced = team as AgentTeam & {
		doAndReview: (
			message: string,
		) => Promise<{ workerResult: AgentResult; reviewResult: AgentResult }>;
	};

	enhanced.doAndReview = async (message: string) => {
		const workerResult = await team.routeTo("worker", message);
		const reviewResult = await team.routeTo(
			"reviewer",
			`Please review this work:\n\n${workerResult.text}`,
		);
		return { workerResult, reviewResult };
	};

	return enhanced;
}

// =============================================================================
// Agent Teams Runtime (lead + teammate collaboration)
// =============================================================================

export type TeamTaskStatus =
	| "pending"
	| "in_progress"
	| "blocked"
	| "completed";

export interface TeamTask {
	id: string;
	title: string;
	description: string;
	status: TeamTaskStatus;
	createdAt: Date;
	updatedAt: Date;
	createdBy: string;
	assignee?: string;
	dependsOn: string[];
	summary?: string;
}

export type MissionLogKind =
	| "progress"
	| "handoff"
	| "blocked"
	| "decision"
	| "done"
	| "error";

export interface MissionLogEntry {
	id: string;
	ts: Date;
	teamId: string;
	agentId: string;
	taskId?: string;
	kind: MissionLogKind;
	summary: string;
	evidence?: string[];
	nextAction?: string;
}

export interface TeamMailboxMessage {
	id: string;
	teamId: string;
	fromAgentId: string;
	toAgentId: string;
	subject: string;
	body: string;
	taskId?: string;
	sentAt: Date;
	readAt?: Date;
}

export interface TeamMemberSnapshot {
	agentId: string;
	role: "lead" | "teammate";
	description?: string;
	status: "idle" | "running" | "stopped";
}

interface TeamMemberState extends TeamMemberSnapshot {
	agent?: Agent;
	runningCount: number;
	lastMissionStep: number;
	lastMissionAt: number;
}

export interface TeamRuntimeSnapshot {
	teamId: string;
	teamName: string;
	members: TeamMemberSnapshot[];
	taskCounts: Record<TeamTaskStatus, number>;
	unreadMessages: number;
	missionLogEntries: number;
	activeRuns: number;
}

export interface TeamRuntimeState {
	teamId: string;
	teamName: string;
	members: TeamMemberSnapshot[];
	tasks: TeamTask[];
	mailbox: TeamMailboxMessage[];
	missionLog: MissionLogEntry[];
}

export interface AgentTeamsRuntimeOptions {
	teamName: string;
	leadAgentId?: string;
	missionLogIntervalSteps?: number;
	missionLogIntervalMs?: number;
	onTeamEvent?: (event: TeamEvent) => void;
}

export interface SpawnTeammateOptions {
	agentId: string;
	config: TeamMemberConfig;
}

export interface RouteToTeammateOptions {
	taskId?: string;
	fromAgentId?: string;
	continueConversation?: boolean;
}

export type TeamRunStatus = "running" | "completed" | "failed";

export interface TeamRunRecord {
	id: string;
	agentId: string;
	taskId?: string;
	status: TeamRunStatus;
	message: string;
	continueConversation?: boolean;
	startedAt: Date;
	endedAt?: Date;
	result?: AgentResult;
	error?: string;
}

export interface AppendMissionLogInput {
	agentId: string;
	taskId?: string;
	kind: MissionLogKind;
	summary: string;
	evidence?: string[];
	nextAction?: string;
}

export interface CreateTeamTaskInput {
	title: string;
	description: string;
	createdBy: string;
	dependsOn?: string[];
	assignee?: string;
}

export class AgentTeamsRuntime {
	private readonly teamId: string;
	private readonly teamName: string;
	private readonly onTeamEvent?: (event: TeamEvent) => void;
	private readonly members: Map<string, TeamMemberState> = new Map();
	private readonly tasks: Map<string, TeamTask> = new Map();
	private readonly missionLog: MissionLogEntry[] = [];
	private readonly mailbox: TeamMailboxMessage[] = [];
	private missionStepCounter = 0;
	private taskCounter = 0;
	private messageCounter = 0;
	private missionCounter = 0;
	private runCounter = 0;
	private readonly runs: Map<string, TeamRunRecord> = new Map();
	private readonly missionLogIntervalSteps: number;
	private readonly missionLogIntervalMs: number;

	constructor(options: AgentTeamsRuntimeOptions) {
		this.teamName = options.teamName;
		this.teamId = `team_${sanitizeId(options.teamName)}_${Date.now().toString(36)}`;
		this.onTeamEvent = options.onTeamEvent;
		this.missionLogIntervalSteps = Math.max(
			1,
			options.missionLogIntervalSteps ?? 3,
		);
		this.missionLogIntervalMs = Math.max(
			1000,
			options.missionLogIntervalMs ?? 120000,
		);
		const leadAgentId = options.leadAgentId ?? "lead";
		this.members.set(leadAgentId, {
			agentId: leadAgentId,
			role: "lead",
			status: "idle",
			runningCount: 0,
			lastMissionStep: 0,
			lastMissionAt: Date.now(),
		});
	}

	getTeamId(): string {
		return this.teamId;
	}

	getTeamName(): string {
		return this.teamName;
	}

	getMemberRole(agentId: string): "lead" | "teammate" | undefined {
		return this.members.get(agentId)?.role;
	}

	getMemberIds(): string[] {
		return Array.from(this.members.keys());
	}

	getTeammateIds(): string[] {
		return Array.from(this.members.values())
			.filter((member) => member.role === "teammate")
			.map((member) => member.agentId);
	}

	getTask(taskId: string): TeamTask | undefined {
		return this.tasks.get(taskId);
	}

	listTasks(): TeamTask[] {
		return Array.from(this.tasks.values());
	}

	listMissionLog(limit?: number): MissionLogEntry[] {
		if (!limit || limit <= 0) {
			return [...this.missionLog];
		}
		return this.missionLog.slice(Math.max(0, this.missionLog.length - limit));
	}

	listMailbox(
		agentId: string,
		options?: { unreadOnly?: boolean; markRead?: boolean; limit?: number },
	): TeamMailboxMessage[] {
		const unreadOnly = options?.unreadOnly ?? true;
		const markRead = options?.markRead ?? true;
		const limit = options?.limit;
		const messages = this.mailbox.filter(
			(message) =>
				message.toAgentId === agentId && (!unreadOnly || !message.readAt),
		);
		const selected =
			typeof limit === "number" && limit > 0
				? messages.slice(Math.max(0, messages.length - limit))
				: messages;
		if (markRead) {
			const now = new Date();
			for (const message of selected) {
				if (!message.readAt) {
					message.readAt = now;
				}
			}
		}
		return selected.map((message) => ({ ...message }));
	}

	getSnapshot(): TeamRuntimeSnapshot {
		const taskCounts: Record<TeamTaskStatus, number> = {
			pending: 0,
			in_progress: 0,
			blocked: 0,
			completed: 0,
		};
		for (const task of this.tasks.values()) {
			taskCounts[task.status]++;
		}
		return {
			teamId: this.teamId,
			teamName: this.teamName,
			members: Array.from(this.members.values()).map((member) => ({
				agentId: member.agentId,
				role: member.role,
				description: member.description,
				status: member.status,
			})),
			taskCounts,
			unreadMessages: this.mailbox.filter((message) => !message.readAt).length,
			missionLogEntries: this.missionLog.length,
			activeRuns: Array.from(this.runs.values()).filter(
				(run) => run.status === "running",
			).length,
		};
	}

	exportState(): TeamRuntimeState {
		return {
			teamId: this.teamId,
			teamName: this.teamName,
			members: Array.from(this.members.values()).map((member) => ({
				agentId: member.agentId,
				role: member.role,
				description: member.description,
				status: member.status,
			})),
			tasks: Array.from(this.tasks.values()).map((task) => ({ ...task })),
			mailbox: this.mailbox.map((message) => ({ ...message })),
			missionLog: this.missionLog.map((entry) => ({ ...entry })),
		};
	}

	hydrateState(state: TeamRuntimeState): void {
		this.tasks.clear();
		for (const task of state.tasks) {
			this.tasks.set(task.id, { ...task });
		}

		this.mailbox.length = 0;
		this.mailbox.push(...state.mailbox.map((message) => ({ ...message })));

		this.missionLog.length = 0;
		this.missionLog.push(...state.missionLog.map((entry) => ({ ...entry })));

		// Keep lead member from current runtime, restore teammate placeholders.
		const leadMembers = Array.from(this.members.values()).filter(
			(member) => member.role === "lead",
		);
		this.members.clear();
		for (const lead of leadMembers) {
			this.members.set(lead.agentId, {
				...lead,
				status: "idle",
				runningCount: 0,
				lastMissionStep: this.missionStepCounter,
				lastMissionAt: Date.now(),
			});
		}
		for (const member of state.members) {
			if (member.role !== "teammate") {
				continue;
			}
			this.members.set(member.agentId, {
				agentId: member.agentId,
				role: "teammate",
				description: member.description,
				status: "stopped",
				agent: undefined,
				runningCount: 0,
				lastMissionStep: this.missionStepCounter,
				lastMissionAt: Date.now(),
			});
		}

		this.taskCounter = Math.max(
			this.taskCounter,
			maxCounter(
				state.tasks.map((task) => task.id),
				"task_",
			),
		);
		this.messageCounter = Math.max(
			this.messageCounter,
			maxCounter(
				state.mailbox.map((message) => message.id),
				"msg_",
			),
		);
		this.missionCounter = Math.max(
			this.missionCounter,
			maxCounter(
				state.missionLog.map((entry) => entry.id),
				"log_",
			),
		);
	}

	isTeammateActive(agentId: string): boolean {
		const member = this.members.get(agentId);
		return !!member && member.role === "teammate" && !!member.agent;
	}

	spawnTeammate({ agentId, config }: SpawnTeammateOptions): TeamMemberSnapshot {
		const existing = this.members.get(agentId);
		if (existing && existing.role !== "teammate") {
			throw new Error(
				`Team member "${agentId}" already exists and is not a teammate`,
			);
		}
		if (existing && existing.runningCount > 0) {
			throw new Error(
				`Teammate "${agentId}" is currently running and cannot be respawned`,
			);
		}

		const wrappedConfig: TeamMemberConfig = {
			...config,
			onEvent: (event: AgentEvent) => {
				config.onEvent?.(event);
				this.emitEvent({ type: TeamMessageType.AgentEvent, agentId, event });
				this.trackMeaningfulEvent(agentId, event);
			},
		};

		const agent = createAgent(wrappedConfig);
		const teammate: TeamMemberState = {
			agentId,
			role: "teammate",
			description: config.role,
			status: "idle",
			agent,
			runningCount: 0,
			lastMissionStep: 0,
			lastMissionAt: Date.now(),
		};
		this.members.set(agentId, teammate);
		this.emitEvent({
			type: TeamMessageType.TeammateSpawned,
			agentId,
			role: config.role,
		});
		return {
			agentId: teammate.agentId,
			role: teammate.role,
			description: teammate.description,
			status: teammate.status,
		};
	}

	shutdownTeammate(agentId: string, reason?: string): void {
		const member = this.members.get(agentId);
		if (!member || member.role !== "teammate") {
			throw new Error(`Teammate "${agentId}" was not found`);
		}
		member.agent?.abort();
		member.status = "stopped";
		this.emitEvent({ type: TeamMessageType.TeammateShutdown, agentId, reason });
	}

	createTask(input: CreateTeamTaskInput): TeamTask {
		const taskId = `task_${String(++this.taskCounter).padStart(4, "0")}`;
		const now = new Date();
		const task: TeamTask = {
			id: taskId,
			title: input.title,
			description: input.description,
			status: input.assignee ? "in_progress" : "pending",
			createdAt: now,
			updatedAt: now,
			createdBy: input.createdBy,
			assignee: input.assignee,
			dependsOn: input.dependsOn ?? [],
		};
		this.tasks.set(taskId, task);
		this.emitEvent({
			type: TeamMessageType.TeamTaskUpdated,
			task: { ...task },
		});
		return { ...task };
	}

	claimTask(taskId: string, agentId: string): TeamTask {
		const task = this.requireTask(taskId);
		this.assertDependenciesResolved(task);
		task.status = "in_progress";
		task.assignee = agentId;
		task.updatedAt = new Date();
		this.emitEvent({
			type: TeamMessageType.TeamTaskUpdated,
			task: { ...task },
		});
		this.appendMissionLog({
			agentId,
			taskId,
			kind: "progress",
			summary: `Claimed task "${task.title}"`,
		});
		return { ...task };
	}

	blockTask(taskId: string, agentId: string, reason: string): TeamTask {
		const task = this.requireTask(taskId);
		task.status = "blocked";
		task.updatedAt = new Date();
		task.summary = reason;
		this.emitEvent({
			type: TeamMessageType.TeamTaskUpdated,
			task: { ...task },
		});
		this.appendMissionLog({
			agentId,
			taskId,
			kind: "blocked",
			summary: reason,
		});
		return { ...task };
	}

	completeTask(taskId: string, agentId: string, summary: string): TeamTask {
		const task = this.requireTask(taskId);
		task.status = "completed";
		task.updatedAt = new Date();
		task.summary = summary;
		if (!task.assignee) {
			task.assignee = agentId;
		}
		this.emitEvent({
			type: TeamMessageType.TeamTaskUpdated,
			task: { ...task },
		});
		this.appendMissionLog({
			agentId,
			taskId,
			kind: "done",
			summary,
		});
		return { ...task };
	}

	async routeToTeammate(
		agentId: string,
		message: string,
		options?: RouteToTeammateOptions,
	): Promise<AgentResult> {
		const member = this.members.get(agentId);
		if (!member || member.role !== "teammate" || !member.agent) {
			throw new Error(`Teammate "${agentId}" was not found`);
		}

		member.runningCount++;
		member.status = "running";
		this.emitEvent({ type: TeamMessageType.TaskStart, agentId, message });

		try {
			const result = options?.continueConversation
				? await member.agent.continue(message)
				: await member.agent.run(message);
			this.emitEvent({ type: TeamMessageType.TaskEnd, agentId, result });
			this.recordProgressStep(
				agentId,
				`Completed a delegated run (${result.iterations} iterations)`,
				options?.taskId,
				true,
			);
			return result;
		} catch (error) {
			const err = error instanceof Error ? error : new Error(String(error));
			this.emitEvent({ type: TeamMessageType.TaskEnd, agentId, error: err });
			this.appendMissionLog({
				agentId,
				taskId: options?.taskId,
				kind: "error",
				summary: err.message,
			});
			throw err;
		} finally {
			member.runningCount--;
			if (
				member.runningCount <= 0 &&
				this.members.get(agentId)?.status !== "stopped"
			) {
				member.status = "idle";
			}
		}
	}

	startTeammateRun(
		agentId: string,
		message: string,
		options?: RouteToTeammateOptions,
	): TeamRunRecord {
		const runId = `run_${String(++this.runCounter).padStart(5, "0")}`;
		const record: TeamRunRecord = {
			id: runId,
			agentId,
			taskId: options?.taskId,
			status: "running",
			message,
			continueConversation: options?.continueConversation,
			startedAt: new Date(),
		};
		this.runs.set(runId, record);

		void this.routeToTeammate(agentId, message, options)
			.then((result) => {
				record.status = "completed";
				record.result = result;
				record.endedAt = new Date();
			})
			.catch((error) => {
				record.status = "failed";
				record.error = error instanceof Error ? error.message : String(error);
				record.endedAt = new Date();
			});

		return { ...record };
	}

	listRuns(options?: {
		status?: TeamRunStatus;
		agentId?: string;
		includeCompleted?: boolean;
	}): TeamRunRecord[] {
		const includeCompleted = options?.includeCompleted ?? true;
		return Array.from(this.runs.values())
			.filter((run) => {
				if (!includeCompleted && run.status !== "running") {
					return false;
				}
				if (options?.status && run.status !== options.status) {
					return false;
				}
				if (options?.agentId && run.agentId !== options.agentId) {
					return false;
				}
				return true;
			})
			.map((run) => ({ ...run }));
	}

	getRun(runId: string): TeamRunRecord | undefined {
		const run = this.runs.get(runId);
		return run ? { ...run } : undefined;
	}

	async awaitRun(runId: string, pollIntervalMs = 250): Promise<TeamRunRecord> {
		const run = this.runs.get(runId);
		if (!run) {
			throw new Error(`Run "${runId}" was not found`);
		}
		while (run.status === "running") {
			await sleep(pollIntervalMs);
		}
		return { ...run };
	}

	async awaitAllRuns(pollIntervalMs = 250): Promise<TeamRunRecord[]> {
		while (
			Array.from(this.runs.values()).some((run) => run.status === "running")
		) {
			await sleep(pollIntervalMs);
		}
		return this.listRuns();
	}

	sendMessage(
		fromAgentId: string,
		toAgentId: string,
		subject: string,
		body: string,
		taskId?: string,
	): TeamMailboxMessage {
		if (!this.members.has(fromAgentId)) {
			throw new Error(`Unknown sender "${fromAgentId}"`);
		}
		if (!this.members.has(toAgentId)) {
			throw new Error(`Unknown recipient "${toAgentId}"`);
		}
		const message: TeamMailboxMessage = {
			id: `msg_${String(++this.messageCounter).padStart(5, "0")}`,
			teamId: this.teamId,
			fromAgentId,
			toAgentId,
			subject,
			body,
			taskId,
			sentAt: new Date(),
		};
		this.mailbox.push(message);
		this.emitEvent({
			type: TeamMessageType.TeamMessage,
			message: { ...message },
		});
		return { ...message };
	}

	broadcast(
		fromAgentId: string,
		subject: string,
		body: string,
		options?: { includeLead?: boolean; taskId?: string },
	): TeamMailboxMessage[] {
		const includeLead = options?.includeLead ?? false;
		const messages: TeamMailboxMessage[] = [];
		for (const member of this.members.values()) {
			if (member.agentId === fromAgentId) {
				continue;
			}
			if (!includeLead && member.role === "lead") {
				continue;
			}
			messages.push(
				this.sendMessage(
					fromAgentId,
					member.agentId,
					subject,
					body,
					options?.taskId,
				),
			);
		}
		return messages;
	}

	appendMissionLog(input: AppendMissionLogInput): MissionLogEntry {
		if (!this.members.has(input.agentId)) {
			throw new Error(`Unknown team member "${input.agentId}"`);
		}
		const entry: MissionLogEntry = {
			id: `log_${String(++this.missionCounter).padStart(6, "0")}`,
			ts: new Date(),
			teamId: this.teamId,
			agentId: input.agentId,
			taskId: input.taskId,
			kind: input.kind,
			summary: input.summary,
			evidence: input.evidence,
			nextAction: input.nextAction,
		};
		this.missionLog.push(entry);
		const member = this.members.get(input.agentId);
		if (member) {
			member.lastMissionAt = Date.now();
			member.lastMissionStep = this.missionStepCounter;
		}
		this.emitEvent({
			type: TeamMessageType.TeamMissionLog,
			entry: { ...entry },
		});
		return { ...entry };
	}

	cleanup(): void {
		for (const member of this.members.values()) {
			if (member.role === "teammate" && member.runningCount > 0) {
				throw new Error(
					`Cannot cleanup team while teammate "${member.agentId}" is still running`,
				);
			}
		}
		if (
			Array.from(this.runs.values()).some((run) => run.status === "running")
		) {
			throw new Error(
				"Cannot cleanup team while async teammate runs are still active",
			);
		}

		for (const member of this.members.values()) {
			if (member.role === "teammate") {
				member.agent?.abort();
			}
		}

		this.tasks.clear();
		this.mailbox.length = 0;
		this.missionLog.length = 0;
		this.runs.clear();

		for (const [memberId, member] of this.members.entries()) {
			if (member.role === "teammate") {
				this.members.delete(memberId);
			}
		}
	}

	private requireTask(taskId: string): TeamTask {
		const task = this.tasks.get(taskId);
		if (!task) {
			throw new Error(`Task "${taskId}" was not found`);
		}
		return task;
	}

	private assertDependenciesResolved(task: TeamTask): void {
		for (const dependencyId of task.dependsOn) {
			const dependency = this.tasks.get(dependencyId);
			if (!dependency || dependency.status !== "completed") {
				throw new Error(`Task "${task.id}" is blocked by "${dependencyId}"`);
			}
		}
	}

	private trackMeaningfulEvent(agentId: string, event: AgentEvent): void {
		if (event.type === "iteration_end" && event.hadToolCalls) {
			this.recordProgressStep(
				agentId,
				`Completed iteration ${event.iteration} with ${event.toolCallCount} tool call(s)`,
			);
			return;
		}

		if (
			event.type === "content_end" &&
			event.contentType === "tool" &&
			!event.error
		) {
			this.recordProgressStep(
				agentId,
				`Finished tool "${event.toolName ?? "unknown"}"`,
			);
			return;
		}

		if (event.type === "done") {
			this.appendMissionLog({
				agentId,
				kind: "done",
				summary: `Run completed after ${event.iterations} iteration(s)`,
			});
			return;
		}

		if (event.type === "error") {
			this.appendMissionLog({
				agentId,
				kind: "error",
				summary: event.error.message,
			});
		}
	}

	private recordProgressStep(
		agentId: string,
		summary: string,
		taskId?: string,
		force = false,
	): void {
		this.missionStepCounter++;
		const member = this.members.get(agentId);
		if (!member) {
			return;
		}
		const stepsSinceLast = this.missionStepCounter - member.lastMissionStep;
		const elapsedMs = Date.now() - member.lastMissionAt;
		if (
			!force &&
			stepsSinceLast < this.missionLogIntervalSteps &&
			elapsedMs < this.missionLogIntervalMs
		) {
			return;
		}
		this.appendMissionLog({
			agentId,
			taskId,
			kind: "progress",
			summary,
		});
	}

	private emitEvent(event: TeamEvent): void {
		try {
			this.onTeamEvent?.(event);
		} catch {
			// Ignore callback errors to avoid disrupting execution.
		}
	}
}

function sanitizeId(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.slice(0, 24);
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function maxCounter(ids: string[], prefix: string): number {
	let max = 0;
	for (const id of ids) {
		if (!id.startsWith(prefix)) {
			continue;
		}
		const value = Number.parseInt(id.slice(prefix.length), 10);
		if (Number.isFinite(value)) {
			max = Math.max(max, value);
		}
	}
	return max;
}
