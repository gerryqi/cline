export type SessionStatus = "running" | "completed" | "failed" | "cancelled";

export enum SessionSource {
	CLI = "cli",
	CLI_SUBAGENT = "cli-subagent",
	CORE = "core",
	CORE_SUBAGENT = "core-subagent",
	DESKTOP = "desktop",
	DESKTOP_CHAT = "desktop-chat",
}
