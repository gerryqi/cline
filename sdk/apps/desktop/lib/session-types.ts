export type AgentStatus =
	| "queued"
	| "running"
	| "completed"
	| "failed"
	| "cancelled";

export interface StartSessionRequest {
	workspaceRoot: string;
	cwd?: string;
	provider: string;
	model: string;
	apiKey: string;
	prompt?: string;
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
	stream: "stdout" | "stderr";
	chunk: string;
	ts: number;
}

export interface SessionEndedEvent {
	sessionId: string;
	reason: string;
	ts: number;
}

export interface SessionHookEvent {
	ts: string;
	hookEventName:
		| "tool_call"
		| "tool_result"
		| "agent_end"
		| "session_shutdown"
		| string;
	agentId?: string;
	conversationId?: string;
	parentAgentId?: string;
	iteration?: number;
	toolName?: string;
	toolInput?: unknown;
	toolOutput?: unknown;
	toolError?: string;
	inputTokens?: number;
	outputTokens?: number;
}

export interface ProcessContext {
	workspaceRoot: string;
	cwd: string;
}

export interface CliDiscoveredSession {
	sessionId: string;
	status: "running" | "completed" | "failed" | "cancelled" | string;
	provider: string;
	model: string;
	cwd: string;
	workspaceRoot: string;
	teamName?: string;
	parentSessionId?: string;
	parentAgentId?: string;
	agentId?: string;
	conversationId?: string;
	isSubagent?: boolean;
	prompt?: string;
	startedAt: string;
	endedAt?: string;
	interactive: boolean;
}
