import type { AgentResult } from "@cline/agents";
import type { providers as LlmsProviders } from "@cline/llms";
import type { SessionSource } from "../types/common";
import type { CoreSessionConfig } from "../types/config";
import type { CoreSessionEvent } from "../types/events";
import type { SessionRecord } from "../types/sessions";
import type { SessionManifest } from "./session-manifest";

export interface StartSessionInput {
	config: CoreSessionConfig;
	source?: SessionSource;
	prompt?: string;
	interactive?: boolean;
	initialMessages?: LlmsProviders.Message[];
	userImages?: string[];
	userFiles?: string[];
	userInstructionWatcher?: import("../agents").UserInstructionConfigWatcher;
	onTeamRestored?: () => void;
	defaultToolExecutors?: Partial<import("../default-tools").ToolExecutors>;
	toolPolicies?: import("@cline/agents").AgentConfig["toolPolicies"];
	requestToolApproval?: (
		request: import("@cline/agents").ToolApprovalRequest,
	) => Promise<import("@cline/agents").ToolApprovalResult>;
}

export interface StartSessionResult {
	sessionId: string;
	manifest: SessionManifest;
	manifestPath: string;
	transcriptPath: string;
	hookPath: string;
	messagesPath: string;
	result?: AgentResult;
}

export interface SendSessionInput {
	sessionId: string;
	prompt: string;
	userImages?: string[];
	userFiles?: string[];
}

export interface SessionManager {
	start(input: StartSessionInput): Promise<StartSessionResult>;
	send(input: SendSessionInput): Promise<AgentResult | undefined>;
	abort(sessionId: string): Promise<void>;
	stop(sessionId: string): Promise<void>;
	get(sessionId: string): Promise<SessionRecord | undefined>;
	list(limit?: number): Promise<SessionRecord[]>;
	delete(sessionId: string): Promise<boolean>;
	readMessages(sessionId: string): Promise<LlmsProviders.Message[]>;
	readTranscript(sessionId: string, maxChars?: number): Promise<string>;
	readHooks(sessionId: string, limit?: number): Promise<unknown[]>;
	subscribe(listener: (event: CoreSessionEvent) => void): () => void;
}
