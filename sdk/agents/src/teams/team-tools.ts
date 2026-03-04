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
import type { providers as LlmsProviders } from "@cline/llms";
import { z } from "zod";
import {
	validateWithZod,
	zodToJsonSchema,
} from "../default-tools/zod-utils.js";
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

export function resolveTeamDataDir(): string {
	const explicitDir = process.env.CLINE_TEAM_DATA_DIR?.trim();
	if (explicitDir) {
		return explicitDir;
	}
	const clineDataDir = process.env.CLINE_DATA_DIR?.trim();
	if (clineDataDir) {
		return join(clineDataDir, "teams");
	}
	return join(homedir(), ".cline", "data", "teams");
}

export class FileTeamPersistenceStore implements TeamPersistenceStore {
	private readonly dirPath: string;
	private readonly statePath: string;
	private readonly taskHistoryPath: string;
	private readonly teammateSpecs: Map<string, TeamTeammateSpec> = new Map();

	constructor(options: FileTeamPersistenceStoreOptions) {
		const safeTeamName = sanitizeTeamName(options.teamName);
		const baseDir = options.baseDir?.trim() || resolveTeamDataDir();
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

const TeamMemberInputSchema = z.object({
	action: z
		.enum(["spawn", "shutdown"])
		.describe("Teammate lifecycle operation"),
	agentId: z.string().min(1).describe("Teammate identifier"),
	rolePrompt: z
		.string()
		.optional()
		.describe("System prompt describing teammate role (required for spawn)"),
	modelId: z.string().optional().describe("Optional model override for spawn"),
	maxIterations: z
		.number()
		.int()
		.min(1)
		.max(40)
		.optional()
		.describe("Max iterations per teammate run for spawn"),
	reason: z.string().optional().describe("Optional shutdown reason"),
});

const TeamMemberSpawnInputSchema = TeamMemberInputSchema.extend({
	action: z.literal("spawn"),
	rolePrompt: z.string().min(1),
});

const TeamMemberShutdownInputSchema = TeamMemberInputSchema.extend({
	action: z.literal("shutdown"),
});

const TeamStatusInputSchema = z.object({});

const TeamTaskInputSchema = z.object({
	action: z
		.enum(["create", "claim", "complete", "block"])
		.describe("Task operation"),
	taskId: z.string().optional().describe("Task ID"),
	title: z.string().optional().describe("Task title for create action"),
	description: z.string().optional().describe("Task details for create action"),
	dependsOn: z
		.array(z.string())
		.optional()
		.describe("Dependency task IDs for create action"),
	assignee: z
		.string()
		.optional()
		.describe("Optional assignee for create action"),
	summary: z.string().optional().describe("Completion summary for complete"),
	reason: z.string().optional().describe("Blocking reason for block"),
});

const TeamCreateTaskInputSchema = TeamTaskInputSchema.extend({
	action: z.literal("create"),
	title: z.string().min(1),
	description: z.string().min(1),
});

const TeamClaimTaskInputSchema = TeamTaskInputSchema.extend({
	action: z.literal("claim"),
	taskId: z.string().min(1),
});

const TeamCompleteTaskInputSchema = TeamTaskInputSchema.extend({
	action: z.literal("complete"),
	taskId: z.string().min(1),
	summary: z.string().min(1),
});

const TeamBlockTaskInputSchema = TeamTaskInputSchema.extend({
	action: z.literal("block"),
	taskId: z.string().min(1),
	reason: z.string().min(1),
});

const TeamRunTaskInputSchema = z.object({
	agentId: z.string().min(1).describe("Teammate agent ID"),
	task: z.string().min(1).describe("Task instructions for the teammate"),
	taskId: z.string().optional().describe("Optional shared task list ID"),
	runMode: z
		.enum(["sync", "async"])
		.optional()
		.describe(
			"Execution mode: sync waits for result; async returns a runId immediately",
		),
	continueConversation: z
		.boolean()
		.optional()
		.describe(
			"If true, continue the teammate conversation; otherwise start fresh",
		),
});

const TeamListRunsInputSchema = z.object({
	status: z.enum(["running", "completed", "failed"]).optional(),
	agentId: z.string().optional().describe("Filter by teammate ID"),
	includeCompleted: z
		.boolean()
		.optional()
		.describe("Include completed/failed runs (default true)"),
});

const TeamAwaitRunBaseInputSchema = z.object({
	awaitAll: z
		.boolean()
		.optional()
		.describe("Wait for all active runs (default false)"),
	runId: z.string().optional().describe("Async run ID to await"),
});

const TeamAwaitRunInputSchema = TeamAwaitRunBaseInputSchema.superRefine(
	(value, ctx) => {
		if (!value.awaitAll && !value.runId) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["runId"],
				message: "runId is required unless awaitAll=true",
			});
		}
	},
);

const TeamAwaitSingleRunInputSchema = TeamAwaitRunBaseInputSchema.extend({
	awaitAll: z.literal(false).optional(),
	runId: z.string().min(1),
});

const TeamMessageInputSchema = z.object({
	action: z.enum(["send", "broadcast", "read"]).describe("Mailbox operation"),
	toAgentId: z
		.string()
		.optional()
		.describe("Recipient agent ID for send action"),
	subject: z.string().optional().describe("Subject for send/broadcast"),
	body: z.string().optional().describe("Body for send/broadcast"),
	taskId: z.string().optional().describe("Optional task ID context"),
	includeLead: z
		.boolean()
		.optional()
		.describe("Include the lead agent in broadcast recipients"),
	unreadOnly: z
		.boolean()
		.optional()
		.describe("Only unread messages for read action (default true)"),
	limit: z
		.number()
		.int()
		.min(1)
		.max(100)
		.optional()
		.describe("Optional max number of messages for read action"),
});

const TeamSendMessageInputSchema = TeamMessageInputSchema.extend({
	action: z.literal("send"),
	toAgentId: z.string().min(1),
	subject: z.string().min(1),
	body: z.string().min(1),
});

const TeamBroadcastMessageInputSchema = TeamMessageInputSchema.extend({
	action: z.literal("broadcast"),
	subject: z.string().min(1),
	body: z.string().min(1),
});

const TeamReadMailboxInputSchema = TeamMessageInputSchema.extend({
	action: z.literal("read"),
});

const TeamLogUpdateInputSchema = z.object({
	kind: z.enum(["progress", "handoff", "blocked", "decision", "done", "error"]),
	summary: z.string().min(1).describe("Update summary"),
	taskId: z.string().optional().describe("Optional task ID context"),
	evidence: z
		.array(z.string())
		.optional()
		.describe("Optional evidence links/snippets"),
	nextAction: z.string().optional().describe("Planned next step"),
});

const TeamCleanupInputSchema = z.object({});

type TeamMemberInput = z.infer<typeof TeamMemberInputSchema>;
type TeamStatusInput = z.infer<typeof TeamStatusInputSchema>;
type TeamTaskInput = z.infer<typeof TeamTaskInputSchema>;
type TeamRunTaskInput = z.infer<typeof TeamRunTaskInputSchema>;
type TeamListRunsInput = z.infer<typeof TeamListRunsInputSchema>;
type TeamAwaitRunInput = z.infer<typeof TeamAwaitRunInputSchema>;
type TeamMessageInput = z.infer<typeof TeamMessageInputSchema>;
type TeamLogUpdateInput = z.infer<typeof TeamLogUpdateInputSchema>;
type TeamCleanupInput = z.infer<typeof TeamCleanupInputSchema>;

export interface TeamTeammateRuntimeConfig {
	providerId: string;
	modelId: string;
	apiKey?: string;
	baseUrl?: string;
	knownModels?: Record<string, LlmsProviders.ModelInfo>;
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
		createTool<TeamMemberInput, { agentId: string; status: string }>({
			name: "team_member",
			description:
				"Manage persistent teammate lifecycle. Use action=spawn or action=shutdown.",
			inputSchema: zodToJsonSchema(TeamMemberInputSchema),
			execute: async (input) => {
				const validatedInput = validateWithZod(TeamMemberInputSchema, input);
				if (options.runtime.getMemberRole(options.requesterId) !== "lead") {
					throw new Error("Only the lead agent can manage teammates.");
				}
				switch (validatedInput.action) {
					case "spawn": {
						const spawnInput = validateWithZod(
							TeamMemberSpawnInputSchema,
							input,
						);
						if (!allowSpawn) {
							throw new Error(
								"Spawning teammates is disabled in this context.",
							);
						}
						const spec: TeamTeammateSpec = {
							agentId: spawnInput.agentId,
							rolePrompt: spawnInput.rolePrompt,
							modelId: spawnInput.modelId,
							maxIterations: spawnInput.maxIterations,
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
						return { agentId: spawnInput.agentId, status: "spawned" };
					}
					case "shutdown": {
						const shutdownInput = validateWithZod(
							TeamMemberShutdownInputSchema,
							input,
						);
						options.runtime.shutdownTeammate(
							shutdownInput.agentId,
							shutdownInput.reason,
						);
						options.persistence?.removeTeammateSpec(shutdownInput.agentId);
						options.persistence?.persist(options.runtime);
						return { agentId: shutdownInput.agentId, status: "stopped" };
					}
				}
			},
		}) as Tool,
	);

	tools.push(
		createTool<TeamStatusInput, ReturnType<AgentTeamsRuntime["getSnapshot"]>>({
			name: "team_status",
			description:
				"Return a snapshot of team members, task counts, mailbox, and mission log stats.",
			inputSchema: zodToJsonSchema(TeamStatusInputSchema),
			execute: async (input) => {
				validateWithZod(TeamStatusInputSchema, input);
				return options.runtime.getSnapshot();
			},
		}) as Tool,
	);

	tools.push(
		createTool<TeamTaskInput, { taskId: string; status: string }>({
			name: "team_task",
			description:
				"Operate on shared team tasks. Use action=create|claim|complete|block.",
			inputSchema: zodToJsonSchema(TeamTaskInputSchema),
			execute: async (input) => {
				const validatedInput = validateWithZod(TeamTaskInputSchema, input);
				switch (validatedInput.action) {
					case "create": {
						const createInput = validateWithZod(
							TeamCreateTaskInputSchema,
							input,
						);
						const task = options.runtime.createTask({
							title: createInput.title,
							description: createInput.description,
							dependsOn: createInput.dependsOn,
							assignee: createInput.assignee,
							createdBy: options.requesterId,
						});
						return { taskId: task.id, status: task.status };
					}
					case "claim": {
						const claimInput = validateWithZod(TeamClaimTaskInputSchema, input);
						const task = options.runtime.claimTask(
							claimInput.taskId,
							options.requesterId,
						);
						return { taskId: task.id, status: task.status };
					}
					case "complete": {
						const completeInput = validateWithZod(
							TeamCompleteTaskInputSchema,
							input,
						);
						const task = options.runtime.completeTask(
							completeInput.taskId,
							options.requesterId,
							completeInput.summary,
						);
						return { taskId: task.id, status: task.status };
					}
					case "block": {
						const blockInput = validateWithZod(TeamBlockTaskInputSchema, input);
						const task = options.runtime.blockTask(
							blockInput.taskId,
							options.requesterId,
							blockInput.reason,
						);
						return { taskId: task.id, status: task.status };
					}
				}
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
			inputSchema: zodToJsonSchema(TeamRunTaskInputSchema),
			execute: async (input) => {
				const validatedInput = validateWithZod(TeamRunTaskInputSchema, input);
				if (validatedInput.runMode === "async") {
					const run = options.runtime.startTeammateRun(
						validatedInput.agentId,
						validatedInput.task,
						{
							taskId: validatedInput.taskId,
							fromAgentId: options.requesterId,
							continueConversation: validatedInput.continueConversation,
						},
					);
					return {
						agentId: validatedInput.agentId,
						mode: "async",
						runId: run.id,
					};
				}
				const result = await options.runtime.routeToTeammate(
					validatedInput.agentId,
					validatedInput.task,
					{
						taskId: validatedInput.taskId,
						fromAgentId: options.requesterId,
						continueConversation: validatedInput.continueConversation,
					},
				);
				return {
					agentId: validatedInput.agentId,
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
			inputSchema: zodToJsonSchema(TeamListRunsInputSchema),
			execute: async (input) =>
				options.runtime.listRuns(
					validateWithZod(TeamListRunsInputSchema, input),
				),
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
			inputSchema: zodToJsonSchema(TeamAwaitRunInputSchema),
			execute: async (input) => {
				const validatedInput = validateWithZod(TeamAwaitRunInputSchema, input);
				if (validatedInput.awaitAll) {
					return options.runtime.awaitAllRuns();
				}
				const singleRunInput = validateWithZod(
					TeamAwaitSingleRunInputSchema,
					input,
				);
				return options.runtime.awaitRun(singleRunInput.runId);
			},
		}) as Tool,
	);

	tools.push(
		createTool<
			TeamMessageInput,
			| { id: string; toAgentId: string }
			| { delivered: number }
			| ReturnType<AgentTeamsRuntime["listMailbox"]>
		>({
			name: "team_message",
			description:
				"Team mailbox operations. Use action=send|broadcast|read for direct messages, broadcasts, and inbox reads.",
			inputSchema: zodToJsonSchema(TeamMessageInputSchema),
			execute: async (input) => {
				const validatedInput = validateWithZod(TeamMessageInputSchema, input);
				switch (validatedInput.action) {
					case "send": {
						const sendInput = validateWithZod(
							TeamSendMessageInputSchema,
							input,
						);
						const message = options.runtime.sendMessage(
							options.requesterId,
							sendInput.toAgentId,
							sendInput.subject,
							sendInput.body,
							sendInput.taskId,
						);
						return { id: message.id, toAgentId: message.toAgentId };
					}
					case "broadcast": {
						const broadcastInput = validateWithZod(
							TeamBroadcastMessageInputSchema,
							input,
						);
						const messages = options.runtime.broadcast(
							options.requesterId,
							broadcastInput.subject,
							broadcastInput.body,
							{
								taskId: broadcastInput.taskId,
								includeLead: broadcastInput.includeLead,
							},
						);
						return { delivered: messages.length };
					}
					case "read": {
						const readInput = validateWithZod(
							TeamReadMailboxInputSchema,
							input,
						);
						return options.runtime.listMailbox(options.requesterId, {
							unreadOnly: readInput.unreadOnly,
							limit: readInput.limit,
							markRead: true,
						});
					}
				}
			},
		}) as Tool,
	);

	tools.push(
		createTool<TeamLogUpdateInput, { id: string }>({
			name: "team_log_update",
			description: "Append a mission log update for this agent.",
			inputSchema: zodToJsonSchema(TeamLogUpdateInputSchema),
			execute: async (input) => {
				const validatedInput = validateWithZod(TeamLogUpdateInputSchema, input);
				const entry = options.runtime.appendMissionLog({
					agentId: options.requesterId,
					taskId: validatedInput.taskId,
					kind: validatedInput.kind,
					summary: validatedInput.summary,
					evidence: validatedInput.evidence,
					nextAction: validatedInput.nextAction,
				});
				return { id: entry.id };
			},
		}) as Tool,
	);

	tools.push(
		createTool<TeamCleanupInput, { status: string }>({
			name: "team_cleanup",
			description:
				"Clean up the team runtime. Fails if teammates are still running.",
			inputSchema: zodToJsonSchema(TeamCleanupInputSchema),
			execute: async (input) => {
				validateWithZod(TeamCleanupInputSchema, input);
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
