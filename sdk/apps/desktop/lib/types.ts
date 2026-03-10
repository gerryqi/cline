export type SessionStream = "stdout" | "stderr";

export interface StartSessionRequest {
	workspaceRoot: string;
	cwd?: string;
	provider: string;
	model: string;
	apiKey: string;
	systemPrompt?: string;
	rules?: string;
	maxIterations?: number;
	enableTools: boolean;
	enableSpawn: boolean;
	enableTeams: boolean;
	autoApproveTools?: boolean;
	teamName: string;
	missionStepInterval: number;
	missionTimeIntervalMs: number;
}

export interface StreamChunkEvent {
	sessionId: string;
	stream: SessionStream;
	chunk: string;
	ts: number;
}

export interface ParsedLogEvent {
	ts: number;
	type:
		| "tool"
		| "team_task"
		| "mailbox"
		| "mission"
		| "team"
		| "error"
		| "info";
	text: string;
}

export interface TeamStateEnvelope {
	version: number;
	updatedAt: string;
	teamState: {
		teamId: string;
		teamName: string;
		members: Array<{
			agentId: string;
			role: string;
			description?: string;
			status: string;
		}>;
		tasks: Array<{
			id: string;
			title: string;
			description: string;
			status: string;
			createdBy: string;
			assignee?: string;
			summary?: string;
			dependsOn: string[];
			createdAt: string;
			updatedAt: string;
		}>;
		mailbox: Array<{
			id: string;
			fromAgentId: string;
			toAgentId: string;
			subject: string;
			body: string;
			taskId?: string;
			sentAt: string;
			readAt?: string;
		}>;
		missionLog: Array<{
			id: string;
			agentId: string;
			taskId?: string;
			kind: string;
			summary: string;
			evidence?: string[];
			nextAction?: string;
			ts: string;
		}>;
		runs?: Array<{
			id: string;
			agentId: string;
			taskId?: string;
			status:
				| "queued"
				| "running"
				| "completed"
				| "failed"
				| "cancelled"
				| "interrupted";
			message: string;
			priority: number;
			retryCount: number;
			maxRetries: number;
			createdAt?: string;
			startedAt: string;
			endedAt?: string;
			error?: string;
		}>;
		outcomes?: Array<{
			id: string;
			title: string;
			status: "draft" | "in_review" | "finalized";
			requiredSections: string[];
			createdAt: string;
			finalizedAt?: string;
		}>;
		outcomeFragments?: Array<{
			id: string;
			outcomeId: string;
			section: string;
			sourceAgentId: string;
			sourceRunId?: string;
			content: string;
			status: "draft" | "reviewed" | "rejected";
			reviewedBy?: string;
			reviewedAt?: string;
			createdAt: string;
		}>;
	};
	teammates: Array<{
		agentId: string;
		rolePrompt: string;
		modelId?: string;
		maxIterations?: number;
	}>;
}

export interface TeamStatusBoardDto {
	members: {
		total: number;
		lead: number;
		teammates: number;
		idle: number;
		running: number;
		stopped: number;
	};
	tasks: {
		total: number;
		pending: number;
		inProgress: number;
		blocked: number;
		completed: number;
		readyTaskIds: string[];
		blockedTaskIds: string[];
	};
	runs: {
		total: number;
		queued: number;
		running: number;
		completed: number;
		failed: number;
		cancelled: number;
		interrupted: number;
	};
	outcomes: {
		total: number;
		draft: number;
		inReview: number;
		finalized: number;
		missingRequiredSections: string[];
	};
	fragments: {
		total: number;
		draft: number;
		reviewed: number;
		rejected: number;
	};
}

export interface TeamHistoryItem {
	ts: string;
	type: string;
	task: Record<string, unknown>;
}
