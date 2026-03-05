export const SESSION_STATUSES = [
	"running",
	"completed",
	"failed",
	"cancelled",
] as const;

export type SessionStatus = (typeof SESSION_STATUSES)[number];

export enum SessionSource {
	CLI = "cli",
	CLI_SUBAGENT = "cli-subagent",
	CORE = "core",
	CORE_SUBAGENT = "core-subagent",
	DESKTOP = "desktop",
	DESKTOP_CHAT = "desktop-chat",
}
