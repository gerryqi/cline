import {
	AgentTeamsRuntime,
	bootstrapAgentTeams,
	createBuiltinTools,
	FileTeamPersistenceStore,
	type TeamEvent,
	type Tool,
} from "@cline/agents";
import { nanoid } from "nanoid";
import type { CoreSessionConfig } from "../types/config";
import type {
	RuntimeBuilder,
	RuntimeBuilderInput,
	BuiltRuntime as RuntimeEnvironment,
} from "./session-runtime";

export function createTeamName(): string {
	return `agent-team-${nanoid(5)}`;
}

function createBuiltinToolsList(cwd: string): Tool[] {
	return createBuiltinTools({
		cwd,
		enableReadFiles: true,
		enableSearch: true,
		enableBash: true,
		enableWebFetch: true,
	});
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
		const { config, hooks, createSpawnTool, onTeamRestored } = input;
		const onTeamEvent = input.onTeamEvent ?? (() => {});
		const normalized = normalizeConfig(config);
		const tools: Tool[] = [];
		const effectiveTeamName = config.teamName?.trim() || createTeamName();
		let teamToolsRegistered = false;

		if (normalized.enableTools) {
			tools.push(...createBuiltinToolsList(config.cwd));
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
						? () => createBuiltinToolsList(config.cwd)
						: undefined,
					teammateRuntime: {
						providerId: config.providerId,
						modelId: config.modelId,
						apiKey: config.apiKey ?? "",
						baseUrl: config.baseUrl,
						knownModels: config.knownModels,
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
			},
		};
	}
}
