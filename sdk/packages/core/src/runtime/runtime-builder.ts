import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
	AgentTeamsRuntime,
	bootstrapAgentTeams,
	createBuiltinTools,
	FileTeamPersistenceStore,
	type SkillsExecutor,
	type TeamEvent,
	type Tool,
	type ToolExecutors,
} from "@cline/agents";
import { nanoid } from "nanoid";
import {
	createUserInstructionConfigWatcher,
	type SkillConfig,
	type UserInstructionConfigWatcher,
} from "../agents";
import type { CoreSessionConfig } from "../types/config";
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

type SkillsExecutorWithMetadata = SkillsExecutor & {
	configuredSkills?: SkillsExecutorMetadataItem[];
};

export function createTeamName(): string {
	return `agent-team-${nanoid(5)}`;
}

function createBuiltinToolsList(
	cwd: string,
	skillsExecutor?: SkillsExecutorWithMetadata,
	executorOverrides?: Partial<ToolExecutors>,
): Tool[] {
	return createBuiltinTools({
		cwd,
		enableReadFiles: true,
		enableSearch: true,
		enableBash: true,
		enableWebFetch: true,
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

function getWorkspaceSkillDirectories(workspacePath: string): string[] {
	return [
		join(workspacePath, ".clinerules", "skills"),
		join(workspacePath, ".cline", "skills"),
		join(workspacePath, ".claude", "skills"),
		join(workspacePath, ".agents", "skills"),
	];
}

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
	for (const directoryPath of getWorkspaceSkillDirectories(workspacePath)) {
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

function normalizeConfig(
	config: CoreSessionConfig,
): Required<
	Pick<
		CoreSessionConfig,
		| "enableTools"
		| "enableSpawnAgent"
		| "enableAgentTeams"
		| "missionLogIntervalSteps"
		| "missionLogIntervalMs"
	>
> {
	return {
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
					skillsExecutor,
					defaultToolExecutors,
				),
			);
		}

		let teamRuntime: AgentTeamsRuntime | undefined;
		const teamPersistence = normalized.enableAgentTeams
			? new FileTeamPersistenceStore({
					teamName: effectiveTeamName,
				})
			: undefined;

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
						if (teamRuntime && teamPersistence) {
							teamPersistence.appendTaskHistory(event);
							teamPersistence.persist(teamRuntime);
						}
					},
				});
			}

			if (!teamToolsRegistered) {
				if (!teamRuntime) {
					return undefined;
				}
				teamToolsRegistered = true;

				const teamBootstrap = bootstrapAgentTeams({
					runtime: teamRuntime,
					leadAgentId: "lead",
					persistence: teamPersistence,
					createBaseTools: normalized.enableTools
						? () =>
								createBuiltinToolsList(
									config.cwd,
									skillsExecutor,
									defaultToolExecutors,
								)
						: undefined,
					teammateRuntime: {
						providerId: config.providerId,
						modelId: config.modelId,
						apiKey: config.apiKey ?? "",
						baseUrl: config.baseUrl,
						knownModels: config.knownModels,
						thinking: config.thinking,
						maxIterations: config.maxIterations,
						hooks,
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

		return {
			tools,
			teamRuntime,
			shutdown: (reason: string) => {
				shutdownTeamRuntime(teamRuntime, reason);
				if (!watcherProvided) {
					userInstructionWatcher?.stop();
				}
			},
		};
	}
}
