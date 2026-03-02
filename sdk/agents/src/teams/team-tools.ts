import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ModelInfo } from "@cline/llms/providers";
import { createTool } from "../tools/create.js";
import type { AgentHooks, Tool } from "../types.js";
import type {
	AgentTeamsRuntime,
	TeamEvent,
	TeamRuntimeState,
} from "./multi-agent.js";

export interface TeamTeammateSpec {
	agentId: string;
	rolePrompt: string;
	modelId?: string;
	maxIterations?: number;
}

export interface TeamPersistenceStore {
	loadState(): TeamRuntimeState | undefined;
	getTeammateSpecs(): TeamTeammateSpec[];
	upsertTeammateSpec(spec: TeamTeammateSpec): void;
	removeTeammateSpec(agentId: string): void;
	persist(runtime: AgentTeamsRuntime): void;
	appendTaskHistory(event: TeamEvent): void;
}

interface PersistedTeamEnvelope {
	version: 1;
	updatedAt: string;
	teamState: TeamRuntimeState;
	teammates: TeamTeammateSpec[];
}

export interface FileTeamPersistenceStoreOptions {
	teamName: string;
	baseDir?: string;
}

export class FileTeamPersistenceStore implements TeamPersistenceStore {
	private readonly dirPath: string;
	private readonly statePath: string;
	private readonly taskHistoryPath: string;
	private readonly teammateSpecs: Map<string, TeamTeammateSpec> = new Map();

	constructor(options: FileTeamPersistenceStoreOptions) {
		const safeTeamName = sanitizeTeamName(options.teamName);
		const baseDir =
			options.baseDir?.trim() ||
			process.env.CLINE_TEAM_DATA_DIR?.trim() ||
			join(homedir(), ".cline", "data", "teams");
		this.dirPath = join(baseDir, safeTeamName);
		this.statePath = join(this.dirPath, "state.json");
		this.taskHistoryPath = join(this.dirPath, "task-history.jsonl");
	}

	loadState(): TeamRuntimeState | undefined {
		if (!existsSync(this.statePath)) {
			return undefined;
		}
		try {
			const raw = readFileSync(this.statePath, "utf8");
			const parsed = JSON.parse(raw) as PersistedTeamEnvelope;
			if (parsed.version !== 1 || !parsed.teamState) {
				return undefined;
			}
			for (const spec of parsed.teammates ?? []) {
				this.teammateSpecs.set(spec.agentId, spec);
			}
			return reviveTeamStateDates(parsed.teamState);
		} catch {
			return undefined;
		}
	}

	getTeammateSpecs(): TeamTeammateSpec[] {
		return Array.from(this.teammateSpecs.values());
	}

	upsertTeammateSpec(spec: TeamTeammateSpec): void {
		this.teammateSpecs.set(spec.agentId, spec);
	}

	removeTeammateSpec(agentId: string): void {
		this.teammateSpecs.delete(agentId);
	}

	persist(runtime: AgentTeamsRuntime): void {
		this.ensureDir();
		const envelope: PersistedTeamEnvelope = {
			version: 1,
			updatedAt: new Date().toISOString(),
			teamState: runtime.exportState(),
			teammates: Array.from(this.teammateSpecs.values()),
		};
		const tmpPath = `${this.statePath}.tmp`;
		writeFileSync(tmpPath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
		renameSync(tmpPath, this.statePath);
	}

	appendTaskHistory(event: TeamEvent): void {
		let task: Record<string, unknown> = {};
		switch (event.type) {
			case "team_task_updated":
				task = event.task as unknown as Record<string, unknown>;
				break;
			case "team_message":
				task = {
					agentId: event.message.fromAgentId,
					toAgentId: event.message.toAgentId,
					subject: event.message.subject,
					taskId: event.message.taskId,
				};
				break;
			case "team_mission_log":
				task = {
					agentId: event.entry.agentId,
					kind: event.entry.kind,
					summary: event.entry.summary,
					taskId: event.entry.taskId,
				};
				break;
			case "teammate_spawned":
			case "teammate_shutdown":
			case "task_start":
				task = {
					agentId: event.agentId,
					message: "message" in event ? event.message : undefined,
				};
				break;
			case "task_end":
				task = {
					agentId: event.agentId,
					finishReason: event.result?.finishReason,
					error: event.error?.message,
				};
				break;
			case "agent_event":
				task = {
					agentId: event.agentId,
					eventType: event.event.type,
				};
				break;
		}
		this.ensureDir();
		appendFileSync(
			this.taskHistoryPath,
			`${JSON.stringify({
				ts: new Date().toISOString(),
				type: event.type,
				task,
			})}\n`,
			"utf8",
		);
	}

	private ensureDir(): void {
		if (!existsSync(this.dirPath)) {
			mkdirSync(this.dirPath, { recursive: true });
		}
	}
}

interface TeamSpawnTeammateInput {
	agentId: string;
	rolePrompt: string;
	modelId?: string;
	maxIterations?: number;
}

interface TeamCreateTaskInput {
	title: string;
	description: string;
	dependsOn?: string[];
	assignee?: string;
}

interface TeamClaimTaskInput {
	taskId: string;
}

interface TeamCompleteTaskInput {
	taskId: string;
	summary: string;
}

interface TeamBlockTaskInput {
	taskId: string;
	reason: string;
}

interface TeamMessageInput {
	toAgentId: string;
	subject: string;
	body: string;
	taskId?: string;
}

interface TeamBroadcastInput {
	subject: string;
	body: string;
	taskId?: string;
	includeLead?: boolean;
}

interface TeamReadMailboxInput {
	unreadOnly?: boolean;
	limit?: number;
}

interface TeamRunTaskInput {
	agentId: string;
	task: string;
	taskId?: string;
	continueConversation?: boolean;
	runMode?: "sync" | "async";
}

interface TeamListRunsInput {
	status?: "running" | "completed" | "failed";
	agentId?: string;
	includeCompleted?: boolean;
}

interface TeamAwaitRunInput {
	runId?: string;
	awaitAll?: boolean;
}

interface TeamLogUpdateInput {
	kind: "progress" | "handoff" | "blocked" | "decision" | "done" | "error";
	summary: string;
	taskId?: string;
	evidence?: string[];
	nextAction?: string;
}

interface TeamShutdownInput {
	agentId: string;
	reason?: string;
}

export interface TeamTeammateRuntimeConfig {
	providerId: string;
	modelId: string;
	apiKey?: string;
	baseUrl?: string;
	knownModels?: Record<string, ModelInfo>;
	thinking?: boolean;
	maxIterations?: number;
	hooks?: AgentHooks;
}

export interface CreateAgentTeamsToolsOptions {
	runtime: AgentTeamsRuntime;
	requesterId: string;
	teammateRuntime: TeamTeammateRuntimeConfig;
	createBaseTools?: () => Tool[];
	allowSpawn?: boolean;
	persistence?: TeamPersistenceStore;
}

export interface BootstrapAgentTeamsOptions {
	runtime: AgentTeamsRuntime;
	teammateRuntime: TeamTeammateRuntimeConfig;
	createBaseTools?: () => Tool[];
	leadAgentId?: string;
	persistence?: TeamPersistenceStore;
}

export interface BootstrapAgentTeamsResult {
	tools: Tool[];
	restoredFromPersistence: boolean;
	restoredTeammates: string[];
}

function spawnTeamTeammate(
	options: Omit<CreateAgentTeamsToolsOptions, "requesterId" | "allowSpawn"> & {
		requesterId: string;
		spec: TeamTeammateSpec;
	},
): void {
	const teammateTools: Tool[] = [];
	if (options.createBaseTools) {
		teammateTools.push(...options.createBaseTools());
	}
	teammateTools.push(
		...createAgentTeamsTools({
			runtime: options.runtime,
			requesterId: options.spec.agentId,
			teammateRuntime: options.teammateRuntime,
			createBaseTools: options.createBaseTools,
			allowSpawn: false,
			persistence: options.persistence,
		}),
	);
	options.runtime.spawnTeammate({
		agentId: options.spec.agentId,
		config: {
			providerId: options.teammateRuntime.providerId,
			modelId: options.spec.modelId ?? options.teammateRuntime.modelId,
			apiKey: options.teammateRuntime.apiKey,
			baseUrl: options.teammateRuntime.baseUrl,
			knownModels: options.teammateRuntime.knownModels,
			thinking: options.teammateRuntime.thinking,
			systemPrompt: options.spec.rolePrompt,
			maxIterations:
				options.spec.maxIterations ?? options.teammateRuntime.maxIterations,
			tools: teammateTools,
			hooks: options.teammateRuntime.hooks,
		},
	});
}

export function bootstrapAgentTeams(
	options: BootstrapAgentTeamsOptions,
): BootstrapAgentTeamsResult {
	const leadAgentId = options.leadAgentId ?? "lead";
	let restoredFromPersistence = false;

	if (options.persistence) {
		const restored = options.persistence.loadState();
		if (restored) {
			options.runtime.hydrateState(restored);
			restoredFromPersistence = true;
		}
	}

	const tools = createAgentTeamsTools({
		runtime: options.runtime,
		requesterId: leadAgentId,
		teammateRuntime: options.teammateRuntime,
		createBaseTools: options.createBaseTools,
		allowSpawn: true,
		persistence: options.persistence,
	});

	const restoredTeammates: string[] = [];
	for (const spec of options.persistence?.getTeammateSpecs() ?? []) {
		if (options.runtime.isTeammateActive(spec.agentId)) {
			continue;
		}
		spawnTeamTeammate({
			runtime: options.runtime,
			requesterId: leadAgentId,
			teammateRuntime: options.teammateRuntime,
			createBaseTools: options.createBaseTools,
			persistence: options.persistence,
			spec,
		});
		restoredTeammates.push(spec.agentId);
	}

	options.persistence?.persist(options.runtime);

	return {
		tools,
		restoredFromPersistence,
		restoredTeammates,
	};
}

export function createAgentTeamsTools(
	options: CreateAgentTeamsToolsOptions,
): Tool[] {
	const allowSpawn = options.allowSpawn ?? true;
	const tools: Tool[] = [];

	tools.push(
		createTool<TeamSpawnTeammateInput, { agentId: string; status: string }>({
			name: "team_spawn_teammate",
			description: "Spawn a persistent teammate in the current agent team.",
			inputSchema: {
				type: "object",
				properties: {
					agentId: {
						type: "string",
						description: "Unique teammate identifier, e.g. reviewer",
					},
					rolePrompt: {
						type: "string",
						description: "System prompt describing the teammate role",
					},
					modelId: {
						type: "string",
						description: "Optional model override for this teammate",
					},
					maxIterations: {
						type: "integer",
						description: "Max iterations per teammate run",
						minimum: 1,
						maximum: 40,
					},
				},
				required: ["agentId", "rolePrompt"],
			},
			execute: async (input) => {
				if (
					!allowSpawn ||
					options.runtime.getMemberRole(options.requesterId) !== "lead"
				) {
					throw new Error("Only the lead agent can spawn teammates.");
				}

				const spec: TeamTeammateSpec = {
					agentId: input.agentId,
					rolePrompt: input.rolePrompt,
					modelId: input.modelId,
					maxIterations: input.maxIterations,
				};

				spawnTeamTeammate({
					runtime: options.runtime,
					requesterId: options.requesterId,
					teammateRuntime: options.teammateRuntime,
					createBaseTools: options.createBaseTools,
					persistence: options.persistence,
					spec,
				});

				options.persistence?.upsertTeammateSpec(spec);
				options.persistence?.persist(options.runtime);
				return { agentId: input.agentId, status: "spawned" };
			},
		}) as Tool,
	);

	tools.push(
		createTool<
			Record<string, never>,
			ReturnType<AgentTeamsRuntime["getSnapshot"]>
		>({
			name: "team_status",
			description:
				"Return a snapshot of team members, task counts, mailbox, and mission log stats.",
			inputSchema: {
				type: "object",
				properties: {},
			},
			execute: async () => options.runtime.getSnapshot(),
		}) as Tool,
	);

	tools.push(
		createTool<TeamCreateTaskInput, { taskId: string; status: string }>({
			name: "team_create_task",
			description: "Create a task in the shared team task list.",
			inputSchema: {
				type: "object",
				properties: {
					title: { type: "string", description: "Task title" },
					description: { type: "string", description: "Task details" },
					dependsOn: {
						type: "array",
						items: { type: "string" },
						description: "Dependency task IDs",
					},
					assignee: {
						type: "string",
						description: "Optional initial assignee",
					},
				},
				required: ["title", "description"],
			},
			execute: async (input) => {
				const task = options.runtime.createTask({
					title: input.title,
					description: input.description,
					dependsOn: input.dependsOn,
					assignee: input.assignee,
					createdBy: options.requesterId,
				});
				return { taskId: task.id, status: task.status };
			},
		}) as Tool,
	);

	tools.push(
		createTool<TeamClaimTaskInput, { taskId: string; status: string }>({
			name: "team_claim_task",
			description: "Claim an unblocked task and set it to in_progress.",
			inputSchema: {
				type: "object",
				properties: {
					taskId: { type: "string", description: "Task ID to claim" },
				},
				required: ["taskId"],
			},
			execute: async (input) => {
				const task = options.runtime.claimTask(
					input.taskId,
					options.requesterId,
				);
				return { taskId: task.id, status: task.status };
			},
		}) as Tool,
	);

	tools.push(
		createTool<TeamCompleteTaskInput, { taskId: string; status: string }>({
			name: "team_complete_task",
			description: "Mark a task as completed with a short summary.",
			inputSchema: {
				type: "object",
				properties: {
					taskId: { type: "string", description: "Task ID to complete" },
					summary: {
						type: "string",
						description: "Completion summary and deliverable notes",
					},
				},
				required: ["taskId", "summary"],
			},
			execute: async (input) => {
				const task = options.runtime.completeTask(
					input.taskId,
					options.requesterId,
					input.summary,
				);
				return { taskId: task.id, status: task.status };
			},
		}) as Tool,
	);

	tools.push(
		createTool<TeamBlockTaskInput, { taskId: string; status: string }>({
			name: "team_block_task",
			description: "Mark a task as blocked and capture the blocking reason.",
			inputSchema: {
				type: "object",
				properties: {
					taskId: { type: "string", description: "Task ID to block" },
					reason: { type: "string", description: "Why the task is blocked" },
				},
				required: ["taskId", "reason"],
			},
			execute: async (input) => {
				const task = options.runtime.blockTask(
					input.taskId,
					options.requesterId,
					input.reason,
				);
				return { taskId: task.id, status: task.status };
			},
		}) as Tool,
	);

	tools.push(
		createTool<
			TeamRunTaskInput,
			{
				agentId: string;
				mode: "sync" | "async";
				runId?: string;
				text?: string;
				iterations?: number;
			}
		>({
			name: "team_run_task",
			description:
				"Route a delegated task to a teammate. Choose sync (wait) or async (run in background).",
			inputSchema: {
				type: "object",
				properties: {
					agentId: { type: "string", description: "Teammate agent ID" },
					task: {
						type: "string",
						description: "Task instructions for that teammate",
					},
					taskId: {
						type: "string",
						description: "Optional shared task list ID",
					},
					runMode: {
						type: "string",
						enum: ["sync", "async"],
						description:
							"Execution mode: sync waits for result; async returns a runId immediately",
					},
					continueConversation: {
						type: "boolean",
						description:
							"If true, continue the teammate conversation; otherwise start fresh",
					},
				},
				required: ["agentId", "task"],
			},
			execute: async (input) => {
				if (input.runMode === "async") {
					const run = options.runtime.startTeammateRun(
						input.agentId,
						input.task,
						{
							taskId: input.taskId,
							fromAgentId: options.requesterId,
							continueConversation: input.continueConversation,
						},
					);
					return { agentId: input.agentId, mode: "async", runId: run.id };
				}
				const result = await options.runtime.routeToTeammate(
					input.agentId,
					input.task,
					{
						taskId: input.taskId,
						fromAgentId: options.requesterId,
						continueConversation: input.continueConversation,
					},
				);
				return {
					agentId: input.agentId,
					mode: "sync",
					text: result.text,
					iterations: result.iterations,
				};
			},
		}) as Tool,
	);

	tools.push(
		createTool<TeamListRunsInput, ReturnType<AgentTeamsRuntime["listRuns"]>>({
			name: "team_list_runs",
			description:
				"List teammate runs started with team_run_task in async mode.",
			inputSchema: {
				type: "object",
				properties: {
					status: { type: "string", enum: ["running", "completed", "failed"] },
					agentId: { type: "string", description: "Filter by teammate ID" },
					includeCompleted: {
						type: "boolean",
						description: "Include completed/failed runs (default true)",
					},
				},
			},
			execute: async (input) =>
				options.runtime.listRuns({
					status: input.status,
					agentId: input.agentId,
					includeCompleted: input.includeCompleted,
				}),
		}) as Tool,
	);

	tools.push(
		createTool<
			TeamAwaitRunInput,
			Awaited<
				| ReturnType<AgentTeamsRuntime["awaitRun"]>
				| ReturnType<AgentTeamsRuntime["awaitAllRuns"]>
			>
		>({
			name: "team_await_run",
			description:
				"Wait for one async run by runId, or wait for all active async runs.",
			inputSchema: {
				type: "object",
				properties: {
					runId: {
						type: "string",
						description: "Async run ID returned by team_run_task",
					},
					awaitAll: {
						type: "boolean",
						description: "Wait for all active runs (default false)",
					},
				},
			},
			execute: async (input) => {
				if (input.awaitAll) {
					return options.runtime.awaitAllRuns();
				}
				if (!input.runId) {
					throw new Error("runId is required unless awaitAll=true");
				}
				return options.runtime.awaitRun(input.runId);
			},
		}) as Tool,
	);

	tools.push(
		createTool<TeamMessageInput, { id: string; toAgentId: string }>({
			name: "team_send_message",
			description: "Send a direct message to another teammate or the lead.",
			inputSchema: {
				type: "object",
				properties: {
					toAgentId: { type: "string", description: "Recipient agent ID" },
					subject: { type: "string", description: "Message subject" },
					body: { type: "string", description: "Message body" },
					taskId: { type: "string", description: "Optional task ID context" },
				},
				required: ["toAgentId", "subject", "body"],
			},
			execute: async (input) => {
				const message = options.runtime.sendMessage(
					options.requesterId,
					input.toAgentId,
					input.subject,
					input.body,
					input.taskId,
				);
				return { id: message.id, toAgentId: message.toAgentId };
			},
		}) as Tool,
	);

	tools.push(
		createTool<TeamBroadcastInput, { delivered: number }>({
			name: "team_broadcast",
			description:
				"Send the same message to all teammates (optionally include lead).",
			inputSchema: {
				type: "object",
				properties: {
					subject: { type: "string", description: "Broadcast subject" },
					body: { type: "string", description: "Broadcast body" },
					taskId: { type: "string", description: "Optional task ID context" },
					includeLead: {
						type: "boolean",
						description: "Include the lead agent in recipients",
					},
				},
				required: ["subject", "body"],
			},
			execute: async (input) => {
				const messages = options.runtime.broadcast(
					options.requesterId,
					input.subject,
					input.body,
					{
						taskId: input.taskId,
						includeLead: input.includeLead,
					},
				);
				return { delivered: messages.length };
			},
		}) as Tool,
	);

	tools.push(
		createTool<
			TeamReadMailboxInput,
			ReturnType<AgentTeamsRuntime["listMailbox"]>
		>({
			name: "team_read_mailbox",
			description: "Read mailbox messages addressed to this agent.",
			inputSchema: {
				type: "object",
				properties: {
					unreadOnly: {
						type: "boolean",
						description: "Only unread messages (default true)",
					},
					limit: {
						type: "integer",
						description: "Optional max number of messages",
						minimum: 1,
						maximum: 100,
					},
				},
			},
			execute: async (input) =>
				options.runtime.listMailbox(options.requesterId, {
					unreadOnly: input.unreadOnly,
					limit: input.limit,
					markRead: true,
				}),
		}) as Tool,
	);

	tools.push(
		createTool<TeamLogUpdateInput, { id: string }>({
			name: "team_log_update",
			description: "Append a mission log update for this agent.",
			inputSchema: {
				type: "object",
				properties: {
					kind: {
						type: "string",
						enum: [
							"progress",
							"handoff",
							"blocked",
							"decision",
							"done",
							"error",
						],
					},
					summary: { type: "string", description: "Update summary" },
					taskId: { type: "string", description: "Optional task ID context" },
					evidence: {
						type: "array",
						items: { type: "string" },
						description: "Optional evidence links/snippets",
					},
					nextAction: { type: "string", description: "Planned next step" },
				},
				required: ["kind", "summary"],
			},
			execute: async (input) => {
				const entry = options.runtime.appendMissionLog({
					agentId: options.requesterId,
					taskId: input.taskId,
					kind: input.kind,
					summary: input.summary,
					evidence: input.evidence,
					nextAction: input.nextAction,
				});
				return { id: entry.id };
			},
		}) as Tool,
	);

	tools.push(
		createTool<TeamShutdownInput, { agentId: string; status: string }>({
			name: "team_shutdown_teammate",
			description:
				"Request teammate shutdown and stop accepting new delegated work.",
			inputSchema: {
				type: "object",
				properties: {
					agentId: { type: "string", description: "Teammate ID to shutdown" },
					reason: { type: "string", description: "Optional shutdown reason" },
				},
				required: ["agentId"],
			},
			execute: async (input) => {
				if (options.runtime.getMemberRole(options.requesterId) !== "lead") {
					throw new Error("Only the lead agent can shut down teammates.");
				}
				options.runtime.shutdownTeammate(input.agentId, input.reason);
				options.persistence?.removeTeammateSpec(input.agentId);
				options.persistence?.persist(options.runtime);
				return { agentId: input.agentId, status: "stopped" };
			},
		}) as Tool,
	);

	tools.push(
		createTool<Record<string, never>, { status: string }>({
			name: "team_cleanup",
			description:
				"Clean up the team runtime. Fails if teammates are still running.",
			inputSchema: {
				type: "object",
				properties: {},
			},
			execute: async () => {
				if (options.runtime.getMemberRole(options.requesterId) !== "lead") {
					throw new Error("Only the lead agent can run cleanup.");
				}
				options.runtime.cleanup();
				options.persistence?.persist(options.runtime);
				return { status: "cleaned" };
			},
		}) as Tool,
	);

	return tools;
}

export function reviveTeamStateDates(
	state: TeamRuntimeState,
): TeamRuntimeState {
	return {
		...state,
		tasks: state.tasks.map((task) => ({
			...task,
			createdAt: new Date(task.createdAt),
			updatedAt: new Date(task.updatedAt),
		})),
		mailbox: state.mailbox.map((message) => ({
			...message,
			sentAt: new Date(message.sentAt),
			readAt: message.readAt ? new Date(message.readAt) : undefined,
		})),
		missionLog: state.missionLog.map((entry) => ({
			...entry,
			ts: new Date(entry.ts),
		})),
	};
}

export function sanitizeTeamName(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "");
}
