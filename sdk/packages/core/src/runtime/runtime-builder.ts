import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
	AgentTeamsRuntime,
	bootstrapAgentTeams,
	type TeamEvent,
	type TeamTeammateSpec,
	type Tool,
} from "@cline/agents";
import { resolveSkillsConfigSearchPaths } from "@cline/shared/storage";
import { nanoid } from "nanoid";
import {
	createUserInstructionConfigWatcher,
	type SkillConfig,
	type UserInstructionConfigWatcher,
} from "../agents";
import {
	createBuiltinTools,
	type SkillsExecutor,
	type ToolExecutors,
	ToolPresets,
} from "../default-tools";
import { SqliteTeamStore } from "../storage/sqlite-team-store";
import type { CoreAgentMode, CoreSessionConfig } from "../types/config";
import type {
	RuntimeBuilder,
	RuntimeBuilderInput,
	BuiltRuntime as RuntimeEnvironment,
} from "./session-runtime";

type SkillsExecutorMetadataItem = {
	id: string;
	name: string;
	description?: string;
	disabled: boolean;
};

const WORKSPACE_CONFIGURATION_MARKER = "# Workspace Configuration";

type SkillsExecutorWithMetadata = SkillsExecutor & {
	configuredSkills?: SkillsExecutorMetadataItem[];
};

export function createTeamName(): string {
	return `agent-team-${nanoid(5)}`;
}

function createBuiltinToolsList(
	cwd: string,
	mode: CoreAgentMode,
	skillsExecutor?: SkillsExecutorWithMetadata,
	executorOverrides?: Partial<ToolExecutors>,
): Tool[] {
	const preset =
		mode === "plan" ? ToolPresets.readonly : ToolPresets.development;
	return createBuiltinTools({
		cwd,
		...preset,
		enableSkills: !!skillsExecutor,
		executors: {
			...(skillsExecutor
				? {
						skills: skillsExecutor,
					}
				: {}),
			...(executorOverrides ?? {}),
		},
	});
}

const SKILL_FILE_NAME = "SKILL.md";

function listAvailableSkillNames(
	watcher: UserInstructionConfigWatcher,
): string[] {
	return listConfiguredSkills(watcher)
		.filter((skill) => !skill.disabled)
		.map((skill) => skill.name.trim())
		.filter((name) => name.length > 0)
		.sort((a, b) => a.localeCompare(b));
}

function listConfiguredSkills(
	watcher: UserInstructionConfigWatcher,
): SkillsExecutorMetadataItem[] {
	const snapshot = watcher.getSnapshot("skill");
	return [...snapshot.entries()].map(([id, record]) => {
		const skill = record.item as SkillConfig;
		return {
			id,
			name: skill.name.trim(),
			description: skill.description?.trim(),
			disabled: skill.disabled === true,
		};
	});
}

function hasSkillsFiles(workspacePath: string): boolean {
	for (const directoryPath of resolveSkillsConfigSearchPaths(workspacePath)) {
		if (!existsSync(directoryPath)) {
			continue;
		}

		const directSkillPath = join(directoryPath, SKILL_FILE_NAME);
		if (existsSync(directSkillPath)) {
			return true;
		}

		try {
			const entries = readdirSync(directoryPath, { withFileTypes: true });
			for (const entry of entries) {
				if (!entry.isDirectory()) {
					continue;
				}
				if (existsSync(join(directoryPath, entry.name, SKILL_FILE_NAME))) {
					return true;
				}
			}
		} catch {
			// Ignore inaccessible directories while probing for local skills.
		}
	}

	return false;
}

function resolveSkillRecord(
	watcher: UserInstructionConfigWatcher,
	requestedSkill: string,
): { id: string; skill: SkillConfig } | { error: string } {
	const normalized = requestedSkill.trim().replace(/^\/+/, "").toLowerCase();
	if (!normalized) {
		return { error: "Missing skill name." };
	}

	const snapshot = watcher.getSnapshot("skill");
	const exact = snapshot.get(normalized);
	if (exact) {
		const skill = exact.item as SkillConfig;
		if (skill.disabled === true) {
			return {
				error: `Skill "${skill.name}" is configured but disabled.`,
			};
		}
		return {
			id: normalized,
			skill,
		};
	}

	const bareName = normalized.includes(":")
		? (normalized.split(":").at(-1) ?? normalized)
		: normalized;

	const suffixMatches = [...snapshot.entries()].filter(([id]) => {
		if (id === bareName) {
			return true;
		}
		return id.endsWith(`:${bareName}`);
	});

	if (suffixMatches.length === 1) {
		const [id, record] = suffixMatches[0];
		const skill = record.item as SkillConfig;
		if (skill.disabled === true) {
			return {
				error: `Skill "${skill.name}" is configured but disabled.`,
			};
		}
		return {
			id,
			skill,
		};
	}

	if (suffixMatches.length > 1) {
		return {
			error: `Skill "${requestedSkill}" is ambiguous. Use one of: ${suffixMatches.map(([id]) => id).join(", ")}`,
		};
	}

	const available = listAvailableSkillNames(watcher);
	return {
		error:
			available.length > 0
				? `Skill "${requestedSkill}" not found. Available skills: ${available.join(", ")}`
				: "No skills are currently available.",
	};
}

function createSkillsExecutor(
	watcher: UserInstructionConfigWatcher,
	watcherReady: Promise<void>,
): SkillsExecutorWithMetadata {
	const runningSkills = new Set<string>();
	const executor: SkillsExecutorWithMetadata = async (skillName, args) => {
		await watcherReady;
		const resolved = resolveSkillRecord(watcher, skillName);
		if ("error" in resolved) {
			return resolved.error;
		}

		const { id, skill } = resolved;
		if (runningSkills.has(id)) {
			return `Skill "${skill.name}" is already running.`;
		}

		runningSkills.add(id);
		try {
			const trimmedArgs = args?.trim();
			const argsTag = trimmedArgs
				? `\n<command-args>${trimmedArgs}</command-args>`
				: "";
			const description = skill.description?.trim()
				? `Description: ${skill.description.trim()}\n\n`
				: "";

			return `<command-name>${skill.name}</command-name>${argsTag}\n<command-instructions>\n${description}${skill.instructions}\n</command-instructions>`;
		} finally {
			runningSkills.delete(id);
		}
	};
	Object.defineProperty(executor, "configuredSkills", {
		get: () => listConfiguredSkills(watcher),
		enumerable: true,
		configurable: false,
	});
	return executor;
}

function shutdownTeamRuntime(
	teamRuntime: AgentTeamsRuntime | undefined,
	reason: string,
): void {
	if (!teamRuntime) {
		return;
	}
	for (const teammateId of teamRuntime.getTeammateIds()) {
		try {
			teamRuntime.shutdownTeammate(teammateId, reason);
		} catch {
			// Best-effort shutdown for all teammates.
		}
	}
}

function extractWorkspaceMetadataFromSystemPrompt(
	systemPrompt: string,
): string | undefined {
	const markerIndex = systemPrompt.lastIndexOf(WORKSPACE_CONFIGURATION_MARKER);
	if (markerIndex < 0) {
		return undefined;
	}
	const metadata = systemPrompt.slice(markerIndex).trim();
	return metadata.length > 0 ? metadata : undefined;
}

function normalizeConfig(
	config: CoreSessionConfig,
): Required<
	Pick<
		CoreSessionConfig,
		| "mode"
		| "enableTools"
		| "enableSpawnAgent"
		| "enableAgentTeams"
		| "missionLogIntervalSteps"
		| "missionLogIntervalMs"
	>
> {
	return {
		mode: config.mode === "plan" ? "plan" : "act",
		enableTools: config.enableTools !== false,
		enableSpawnAgent: config.enableSpawnAgent !== false,
		enableAgentTeams: config.enableAgentTeams !== false,
		missionLogIntervalSteps:
			typeof config.missionLogIntervalSteps === "number" &&
			Number.isFinite(config.missionLogIntervalSteps)
				? config.missionLogIntervalSteps
				: 3,
		missionLogIntervalMs:
			typeof config.missionLogIntervalMs === "number" &&
			Number.isFinite(config.missionLogIntervalMs)
				? config.missionLogIntervalMs
				: 120000,
	};
}

export class DefaultRuntimeBuilder implements RuntimeBuilder {
	build(input: RuntimeBuilderInput): RuntimeEnvironment {
		const {
			config,
			hooks,
			extensions,
			logger,
			createSpawnTool,
			onTeamRestored,
			userInstructionWatcher: sharedUserInstructionWatcher,
			defaultToolExecutors,
		} = input;
		const onTeamEvent = input.onTeamEvent ?? (() => {});
		const normalized = normalizeConfig(config);
		const tools: Tool[] = [];
		const effectiveTeamName = config.teamName?.trim() || createTeamName();
		let teamToolsRegistered = false;
		const watcherProvided = Boolean(sharedUserInstructionWatcher);
		let userInstructionWatcher = sharedUserInstructionWatcher;
		let watcherReady = Promise.resolve();
		let skillsExecutor: SkillsExecutorWithMetadata | undefined;

		if (
			!userInstructionWatcher &&
			normalized.enableTools &&
			hasSkillsFiles(config.cwd)
		) {
			userInstructionWatcher = createUserInstructionConfigWatcher({
				skills: { workspacePath: config.cwd },
				rules: { workspacePath: config.cwd },
				workflows: { workspacePath: config.cwd },
			});
			watcherReady = userInstructionWatcher.start().catch(() => {});
		}

		if (
			normalized.enableTools &&
			userInstructionWatcher &&
			(watcherProvided ||
				hasSkillsFiles(config.cwd) ||
				listConfiguredSkills(userInstructionWatcher).length > 0)
		) {
			skillsExecutor = createSkillsExecutor(
				userInstructionWatcher,
				watcherReady,
			);
		}

		if (normalized.enableTools) {
			tools.push(
				...createBuiltinToolsList(
					config.cwd,
					normalized.mode,
					skillsExecutor,
					defaultToolExecutors,
				),
			);
		}

		let teamRuntime: AgentTeamsRuntime | undefined;
		const teamStore = normalized.enableAgentTeams
			? new SqliteTeamStore()
			: undefined;
		teamStore?.init();
		const restoredTeam = teamStore?.loadRuntime(effectiveTeamName);
		const restoredTeamState = restoredTeam?.state;
		const restoredTeammateSpecs = restoredTeam?.teammates ?? [];
		const teammateSpecs = new Map(
			restoredTeammateSpecs.map((spec) => [spec.agentId, spec] as const),
		);

		const ensureTeamRuntime = (): AgentTeamsRuntime | undefined => {
			if (!normalized.enableAgentTeams) {
				return undefined;
			}

			if (!teamRuntime) {
				teamRuntime = new AgentTeamsRuntime({
					teamName: effectiveTeamName,
					leadAgentId: "lead",
					missionLogIntervalSteps: normalized.missionLogIntervalSteps,
					missionLogIntervalMs: normalized.missionLogIntervalMs,
					onTeamEvent: (event: TeamEvent) => {
						onTeamEvent(event);
						if (teamRuntime && teamStore) {
							if (
								event.type === "teammate_spawned" &&
								event.teammate?.rolePrompt
							) {
								const spec: TeamTeammateSpec = {
									agentId: event.agentId,
									rolePrompt: event.teammate.rolePrompt,
									modelId: event.teammate.modelId,
									maxIterations: event.teammate.maxIterations,
								};
								teammateSpecs.set(spec.agentId, spec);
							}
							if (event.type === "teammate_shutdown") {
								teammateSpecs.delete(event.agentId);
							}
							teamStore.handleTeamEvent(effectiveTeamName, event);
							teamStore.persistRuntime(
								effectiveTeamName,
								teamRuntime.exportState(),
								Array.from(teammateSpecs.values()),
							);
						}
					},
				});
				if (restoredTeamState) {
					teamRuntime.hydrateState(restoredTeamState);
					teamRuntime.markStaleRunsInterrupted("runtime_recovered");
				}
			}

			if (!teamToolsRegistered) {
				if (!teamRuntime) {
					return undefined;
				}
				teamToolsRegistered = true;

				const teamBootstrap = bootstrapAgentTeams({
					runtime: teamRuntime,
					leadAgentId: "lead",
					restoredFromPersistence: Boolean(restoredTeamState),
					restoredTeammates: restoredTeammateSpecs,
					createBaseTools: normalized.enableTools
						? () =>
								createBuiltinToolsList(
									config.cwd,
									normalized.mode,
									skillsExecutor,
									defaultToolExecutors,
								)
						: undefined,
					teammateRuntime: {
						providerId: config.providerId,
						modelId: config.modelId,
						cwd: config.cwd,
						apiKey: config.apiKey ?? "",
						baseUrl: config.baseUrl,
						headers: config.headers,
						providerConfig: config.providerConfig,
						knownModels: config.knownModels,
						thinking: config.thinking,
						clineWorkspaceMetadata:
							config.providerId === "cline"
								? extractWorkspaceMetadataFromSystemPrompt(config.systemPrompt)
								: undefined,
						maxIterations: config.maxIterations,
						hooks,
						extensions: extensions ?? config.extensions,
						logger: logger ?? config.logger,
					},
				});

				if (teamBootstrap.restoredFromPersistence) {
					onTeamRestored?.();
				}
				tools.push(...teamBootstrap.tools);
			}

			return teamRuntime;
		};

		if (normalized.enableSpawnAgent && createSpawnTool) {
			const spawnTool = createSpawnTool();
			tools.push({
				...spawnTool,
				execute: async (spawnInput, context) => {
					ensureTeamRuntime();
					return spawnTool.execute(spawnInput, context);
				},
			});
		}

		if (normalized.enableAgentTeams) {
			ensureTeamRuntime();
		}

		const completionGuard = teamRuntime
			? () => {
					const rt = teamRuntime;
					if (!rt) return undefined;
					const tasks = rt.listTasks();
					const hasInProgress = tasks.some(
						(t) => t.status === "in_progress" || t.status === "pending",
					);
					const runs = rt.listRuns({});
					const hasActiveRuns = runs.some(
						(r) => r.status === "running" || r.status === "queued",
					);
					if (hasInProgress || hasActiveRuns) {
						const pending = tasks
							.filter(
								(t) => t.status === "in_progress" || t.status === "pending",
							)
							.map((t) => `${t.id} (${t.status}): ${t.title}`)
							.join(", ");
						const activeRunSummary = runs
							.filter((r) => r.status === "running" || r.status === "queued")
							.map((r) => `${r.id} (${r.status})`)
							.join(", ");
						const parts = [];
						if (pending) parts.push(`Unfinished tasks: ${pending}`);
						if (activeRunSummary)
							parts.push(`Active runs: ${activeRunSummary}`);
						return `[SYSTEM] You still have team obligations. ${parts.join(". ")}. Use team_run_task to delegate work, or team_complete_task to mark tasks done, or team_await_run / team_await_all_runs to wait for active runs. Do NOT stop until all tasks are completed.`;
					}
					return undefined;
				}
			: undefined;

		return {
			tools,
			logger: logger ?? config.logger,
			teamRuntime,
			completionGuard,
			shutdown: (reason: string) => {
				shutdownTeamRuntime(teamRuntime, reason);
				if (!watcherProvided) {
					userInstructionWatcher?.stop();
				}
			},
		};
	}
}
