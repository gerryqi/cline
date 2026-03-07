import { existsSync, readdirSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { HookEventName } from "@cline/agents";
import {
	DOCUMENTS_HOOKS_DIRECTORY_PATH,
	HOOKS_CONFIG_DIRECTORY_NAME,
	resolveHooksConfigSearchPaths as resolveHooksConfigSearchPathsFromShared,
} from "@cline/shared/storage";

export { DOCUMENTS_HOOKS_DIRECTORY_PATH, HOOKS_CONFIG_DIRECTORY_NAME };

export function resolveHooksConfigSearchPaths(
	workspacePath?: string,
): string[] {
	return resolveHooksConfigSearchPathsFromShared(workspacePath);
}

export enum HookConfigFileName {
	TaskStart = "TaskStart",
	TaskResume = "TaskResume",
	TaskCancel = "TaskCancel",
	TaskComplete = "TaskComplete",
	PreToolUse = "PreToolUse",
	PostToolUse = "PostToolUse",
	UserPromptSubmit = "UserPromptSubmit",
	PreCompact = "PreCompact",
	SessionShutdown = "SessionShutdown",
}

export const HOOK_CONFIG_FILE_EVENT_MAP: Readonly<
	Record<HookConfigFileName, HookEventName | undefined>
> = {
	[HookConfigFileName.TaskStart]: "agent_start",
	[HookConfigFileName.TaskResume]: "agent_resume",
	[HookConfigFileName.TaskCancel]: "agent_abort",
	[HookConfigFileName.TaskComplete]: "agent_end",
	[HookConfigFileName.PreToolUse]: "tool_call",
	[HookConfigFileName.PostToolUse]: "tool_result",
	[HookConfigFileName.UserPromptSubmit]: "prompt_submit",
	[HookConfigFileName.PreCompact]: undefined,
	[HookConfigFileName.SessionShutdown]: "session_shutdown",
};

const HOOK_CONFIG_FILE_LOOKUP = new Map<string, HookConfigFileName>(
	Object.values(HookConfigFileName).map((name) => [name.toLowerCase(), name]),
);

export function toHookConfigFileName(
	fileName: string,
): HookConfigFileName | undefined {
	const key = basename(fileName, extname(fileName)).trim().toLowerCase();
	return HOOK_CONFIG_FILE_LOOKUP.get(key);
}

export interface HookConfigFileEntry {
	fileName: HookConfigFileName;
	hookEventName?: HookEventName;
	path: string;
}

export function listHookConfigFiles(
	workspacePath?: string,
): HookConfigFileEntry[] {
	const entries: HookConfigFileEntry[] = [];
	const seen = new Set<string>();
	const directories = resolveHooksConfigSearchPaths(workspacePath).filter(
		(directory) => existsSync(directory),
	);

	for (const directory of directories) {
		try {
			for (const entry of readdirSync(directory, { withFileTypes: true })) {
				if (!entry.isFile()) {
					continue;
				}
				const fileName = toHookConfigFileName(entry.name);
				if (!fileName) {
					continue;
				}
				const path = join(directory, entry.name);
				if (seen.has(path)) {
					continue;
				}
				seen.add(path);
				entries.push({
					fileName,
					hookEventName: HOOK_CONFIG_FILE_EVENT_MAP[fileName],
					path,
				});
			}
		} catch {
			// Best-effort listing across config roots.
		}
	}

	return entries.sort((a, b) => a.path.localeCompare(b.path));
}
