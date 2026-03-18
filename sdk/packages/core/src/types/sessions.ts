import type {
	SessionLineage,
	SessionRuntimeRecordShape,
} from "@clinebot/shared";
import type { SessionSource, SessionStatus } from "./common";

export interface SessionRef extends SessionLineage {
	sessionId: string;
}

export interface SessionRecord
	extends SessionRef,
		Omit<SessionRuntimeRecordShape, "source" | "status"> {
	source: SessionSource;
	status: SessionStatus;
}
