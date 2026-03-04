import type { AgentResult } from "@cline/agents";
import type { CoreSessionConfig } from "../types/config";
import type { CoreSessionEvent } from "../types/events";
import type { SessionRecord } from "../types/sessions";

export interface SessionManager {
	start(
		config: CoreSessionConfig,
		prompt?: string,
		interactive?: boolean,
	): Promise<{ sessionId: string }>;
	send(sessionId: string, prompt: string): Promise<AgentResult | undefined>;
	abort(sessionId: string): Promise<void>;
	stop(sessionId: string): Promise<void>;
	get(sessionId: string): Promise<SessionRecord | undefined>;
	list(limit?: number): Promise<SessionRecord[]>;
	delete(sessionId: string): Promise<boolean>;
	readTranscript(sessionId: string, maxChars?: number): Promise<string>;
	readHooks(sessionId: string, limit?: number): Promise<unknown[]>;
	subscribe(listener: (event: CoreSessionEvent) => void): () => void;
}
