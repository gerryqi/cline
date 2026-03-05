import type { providers as LlmsProviders } from "@cline/llms";
import { type Tool, validateWithZod, zodToJsonSchema } from "@cline/shared";
import { z } from "zod";
import { createTool } from "../tools/create.js";
import type { AgentHooks, BasicLogger } from "../types.js";
import type { AgentTeamsRuntime, TeamRuntimeState } from "./multi-agent.js";

export interface TeamTeammateSpec {
	agentId: string;
	rolePrompt: string;
	modelId?: string;
	maxIterations?: number;
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

function formatTeamMemberInputError(input: unknown): string {
	const action =
		typeof input === "object" && input !== null && "action" in input
			? (input as { action?: unknown }).action
			: undefined;
	if (action === "spawn") {
		return (
			'team_member action=spawn requires non-empty "agentId" and "rolePrompt". ' +
			'Example: {"action":"spawn","agentId":"python-poet","rolePrompt":"Write concise Python-focused haiku"}'
		);
	}
	if (action === "shutdown") {
		return (
			'team_member action=shutdown requires non-empty "agentId". ' +
			'Example: {"action":"shutdown","agentId":"python-poet"}'
		);
	}
	return (
		'team_member requires "action" (spawn|shutdown). ' +
		'For spawn include "agentId" and "rolePrompt"; for shutdown include "agentId".'
	);
}

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
	logger?: BasicLogger;
}

export interface CreateAgentTeamsToolsOptions {
	runtime: AgentTeamsRuntime;
	requesterId: string;
	teammateRuntime: TeamTeammateRuntimeConfig;
	createBaseTools?: () => Tool[];
	allowSpawn?: boolean;
}

export interface BootstrapAgentTeamsOptions {
	runtime: AgentTeamsRuntime;
	teammateRuntime: TeamTeammateRuntimeConfig;
	createBaseTools?: () => Tool[];
	leadAgentId?: string;
	restoredTeammates?: TeamTeammateSpec[];
	restoredFromPersistence?: boolean;
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
			logger: options.teammateRuntime.logger,
		},
	});
}

export function bootstrapAgentTeams(
	options: BootstrapAgentTeamsOptions,
): BootstrapAgentTeamsResult {
	const leadAgentId = options.leadAgentId ?? "lead";
	const restoredFromPersistence = options.restoredFromPersistence === true;

	const tools = createAgentTeamsTools({
		runtime: options.runtime,
		requesterId: leadAgentId,
		teammateRuntime: options.teammateRuntime,
		createBaseTools: options.createBaseTools,
		allowSpawn: true,
	});

	const restoredTeammates: string[] = [];
	for (const spec of options.restoredTeammates ?? []) {
		if (options.runtime.isTeammateActive(spec.agentId)) {
			continue;
		}
		spawnTeamTeammate({
			runtime: options.runtime,
			requesterId: leadAgentId,
			teammateRuntime: options.teammateRuntime,
			createBaseTools: options.createBaseTools,
			spec,
		});
		restoredTeammates.push(spec.agentId);
	}

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
				"Manage teammate lifecycle. action=spawn requires agentId+rolePrompt; action=shutdown requires agentId.",
			inputSchema: zodToJsonSchema(TeamMemberInputSchema),
			execute: async (input) => {
				const validatedInputResult = TeamMemberInputSchema.safeParse(input);
				if (!validatedInputResult.success) {
					throw new Error(formatTeamMemberInputError(input));
				}
				const validatedInput = validatedInputResult.data;
				if (options.runtime.getMemberRole(options.requesterId) !== "lead") {
					throw new Error("Only the lead agent can manage teammates.");
				}
				switch (validatedInput.action) {
					case "spawn": {
						const spawnInputResult =
							TeamMemberSpawnInputSchema.safeParse(input);
						if (!spawnInputResult.success) {
							throw new Error(formatTeamMemberInputError(input));
						}
						const spawnInput = spawnInputResult.data;
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
							spec,
						});
						return { agentId: spawnInput.agentId, status: "spawned" };
					}
					case "shutdown": {
						const shutdownInputResult =
							TeamMemberShutdownInputSchema.safeParse(input);
						if (!shutdownInputResult.success) {
							throw new Error(formatTeamMemberInputError(input));
						}
						const shutdownInput = shutdownInputResult.data;
						options.runtime.shutdownTeammate(
							shutdownInput.agentId,
							shutdownInput.reason,
						);
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
