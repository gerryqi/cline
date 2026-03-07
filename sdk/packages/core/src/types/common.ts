import { SESSION_STATUS_VALUES } from "@cline/shared";

export const SESSION_STATUSES = SESSION_STATUS_VALUES;

export type SessionStatus = (typeof SESSION_STATUSES)[number];

export enum SessionSource {
	CLI = "cli",
	CLI_SUBAGENT = "cli-subagent",
	CORE = "core",
	CORE_SUBAGENT = "core-subagent",
	DESKTOP = "desktop",
	DESKTOP_CHAT = "desktop-chat",
}
