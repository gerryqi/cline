import type { providers as LlmsProviders } from "@cline/llms";
import type { CoreSessionEvent } from "./types/events";

export type {
	ChatMessage,
	ChatSessionConfig,
	ChatSessionStatus,
	ChatSummary,
	ChatViewState,
} from "./chat/chat-schema";
export type {
	BuiltRuntime as RuntimeEnvironment,
	RuntimeBuilder,
	RuntimeBuilderInput,
	SessionRuntime,
} from "./runtime/session-runtime";
export type { SessionManager } from "./session/session-manager";
export type { SessionManifest } from "./session/session-manifest";
export type {
	CreateRootSessionWithArtifactsInput,
	RootSessionArtifacts,
} from "./session/session-service";
export type {
	WorkspaceManager,
	WorkspaceManagerEvent,
} from "./session/workspace-manager";
export type { WorkspaceManifest } from "./session/workspace-manifest";
export type { SessionSource, SessionStatus } from "./types/common";
export type {
	CoreModelConfig,
	CoreRuntimeFeatures,
	CoreSessionConfig,
} from "./types/config";
export type {
	CoreSessionEvent,
	SessionChunkEvent,
	SessionEndedEvent,
	SessionToolEvent,
} from "./types/events";
export type { SessionRecord, SessionRef } from "./types/sessions";
export type { ArtifactStore, SessionStore, TeamStore } from "./types/storage";
export type { WorkspaceInfo } from "./types/workspace";

// Backward-compat alias used by CLI persistence.
export interface StoredMessages {
	version: 1;
	updatedAt: string;
	messages: LlmsProviders.Message[];
}

// Backward-compat alias with previous event naming.
export type SessionEvent = CoreSessionEvent;
