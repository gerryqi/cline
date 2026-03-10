import type { TeamStateEnvelope, TeamStatusBoardDto } from "./types";

export function buildTeamStatusBoardDto(
	envelope: TeamStateEnvelope | null,
): TeamStatusBoardDto {
	const team = envelope?.teamState;
	const tasks = team?.tasks ?? [];
	const taskById = new Map(tasks.map((task) => [task.id, task] as const));
	const runs = team?.runs ?? [];
	const outcomes = team?.outcomes ?? [];
	const outcomeFragments = team?.outcomeFragments ?? [];
	const reviewedByOutcomeSection = new Set<string>();
	for (const fragment of outcomeFragments) {
		if (fragment.status === "reviewed") {
			reviewedByOutcomeSection.add(`${fragment.outcomeId}:${fragment.section}`);
		}
	}
	const missingRequiredSections = new Set<string>();
	for (const outcome of outcomes) {
		if (outcome.status === "finalized") {
			continue;
		}
		for (const section of outcome.requiredSections ?? []) {
			const key = `${outcome.id}:${section}`;
			if (!reviewedByOutcomeSection.has(key)) {
				missingRequiredSections.add(key);
			}
		}
	}
	return {
		members: {
			total: team?.members.length ?? 0,
			lead: (team?.members ?? []).filter((m) => m.role === "lead").length,
			teammates: (team?.members ?? []).filter((m) => m.role !== "lead").length,
			idle: (team?.members ?? []).filter((m) => m.status === "idle").length,
			running: (team?.members ?? []).filter((m) => m.status === "running")
				.length,
			stopped: (team?.members ?? []).filter((m) => m.status === "stopped")
				.length,
		},
		tasks: {
			total: tasks.length,
			pending: tasks.filter((task) => task.status === "pending").length,
			inProgress: tasks.filter((task) => task.status === "in_progress").length,
			blocked: tasks.filter((task) => task.status === "blocked").length,
			completed: tasks.filter((task) => task.status === "completed").length,
			readyTaskIds: tasks
				.filter(
					(task) =>
						task.status === "pending" &&
						task.dependsOn.every(
							(depId) => taskById.get(depId)?.status === "completed",
						),
				)
				.map((task) => task.id),
			blockedTaskIds: tasks
				.filter((task) => task.status === "blocked")
				.map((task) => task.id),
		},
		runs: {
			total: runs.length,
			queued: runs.filter((run) => run.status === "queued").length,
			running: runs.filter((run) => run.status === "running").length,
			completed: runs.filter((run) => run.status === "completed").length,
			failed: runs.filter((run) => run.status === "failed").length,
			cancelled: runs.filter((run) => run.status === "cancelled").length,
			interrupted: runs.filter((run) => run.status === "interrupted").length,
		},
		outcomes: {
			total: outcomes.length,
			draft: outcomes.filter((outcome) => outcome.status === "draft").length,
			inReview: outcomes.filter((outcome) => outcome.status === "in_review")
				.length,
			finalized: outcomes.filter((outcome) => outcome.status === "finalized")
				.length,
			missingRequiredSections: [...missingRequiredSections].sort((a, b) =>
				a.localeCompare(b),
			),
		},
		fragments: {
			total: outcomeFragments.length,
			draft: outcomeFragments.filter((fragment) => fragment.status === "draft")
				.length,
			reviewed: outcomeFragments.filter(
				(fragment) => fragment.status === "reviewed",
			).length,
			rejected: outcomeFragments.filter(
				(fragment) => fragment.status === "rejected",
			).length,
		},
	};
}
