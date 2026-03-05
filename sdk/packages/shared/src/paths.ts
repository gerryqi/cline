import { homedir } from "node:os";
import { join } from "node:path";

export const AGENT_CONFIG_DIRECTORY_NAME = "agents";
export const HOOKS_CONFIG_DIRECTORY_NAME = "hooks";
export const SKILLS_CONFIG_DIRECTORY_NAME = "skills";
export const RULES_CONFIG_DIRECTORY_NAME = "rules";
export const WORKFLOWS_CONFIG_DIRECTORY_NAME = "workflows";
export const CLINE_MCP_SETTINGS_FILE_NAME = "cline_mcp_settings.json";

export const DOCUMENTS_CLINE_DIRECTORY_PATH = join(
	homedir(),
	"Documents",
	"Cline",
);
export const DOCUMENTS_AGENT_CONFIG_DIRECTORY_PATH = join(
	DOCUMENTS_CLINE_DIRECTORY_PATH,
	"Agents",
);
export const DOCUMENTS_HOOKS_DIRECTORY_PATH = join(
	DOCUMENTS_CLINE_DIRECTORY_PATH,
	"Hooks",
);
export const DOCUMENTS_RULES_DIRECTORY_PATH = join(
	DOCUMENTS_CLINE_DIRECTORY_PATH,
	"Rules",
);
export const DOCUMENTS_WORKFLOWS_DIRECTORY_PATH = join(
	DOCUMENTS_CLINE_DIRECTORY_PATH,
	"Workflows",
);

export function resolveClineDataDir(): string {
	const explicitDir = process.env.CLINE_DATA_DIR?.trim();
	if (explicitDir) {
		return explicitDir;
	}
	return join(homedir(), ".cline", "data");
}

export function resolveSessionDataDir(): string {
	const explicitDir = process.env.CLINE_SESSION_DATA_DIR?.trim();
	if (explicitDir) {
		return explicitDir;
	}
	return join(resolveClineDataDir(), "sessions");
}

export function resolveTeamDataDir(): string {
	const explicitDir = process.env.CLINE_TEAM_DATA_DIR?.trim();
	if (explicitDir) {
		return explicitDir;
	}
	return join(resolveClineDataDir(), "teams");
}

export function resolveProviderSettingsPath(): string {
	const explicitPath = process.env.CLINE_PROVIDER_SETTINGS_PATH?.trim();
	if (explicitPath) {
		return explicitPath;
	}
	return join(resolveClineDataDir(), "settings", "providers.json");
}

export function resolveMcpSettingsPath(): string {
	const explicitPath = process.env.CLINE_MCP_SETTINGS_PATH?.trim();
	if (explicitPath) {
		return explicitPath;
	}
	return join(resolveClineDataDir(), "settings", CLINE_MCP_SETTINGS_FILE_NAME);
}

function dedupePaths(paths: ReadonlyArray<string>): string[] {
	const seen = new Set<string>();
	const deduped: string[] = [];
	for (const candidate of paths) {
		if (!candidate || seen.has(candidate)) {
			continue;
		}
		seen.add(candidate);
		deduped.push(candidate);
	}
	return deduped;
}

function getWorkspaceSkillDirectories(workspacePath?: string): string[] {
	if (!workspacePath) {
		return [];
	}
	return [
		join(workspacePath, ".clinerules", "skills"),
		join(workspacePath, ".cline", "skills"),
		join(workspacePath, ".claude", "skills"),
		join(workspacePath, ".agents", "skills"),
	];
}

export function resolveAgentsConfigDirPath(): string {
	return join(resolveClineDataDir(), "settings", AGENT_CONFIG_DIRECTORY_NAME);
}

export function resolveAgentConfigSearchPaths(): string[] {
	return [DOCUMENTS_AGENT_CONFIG_DIRECTORY_PATH, resolveAgentsConfigDirPath()];
}

export function resolveHooksConfigSearchPaths(
	workspacePath?: string,
): string[] {
	return dedupePaths([
		workspacePath
			? join(workspacePath, ".clinerules", HOOKS_CONFIG_DIRECTORY_NAME)
			: "",
		DOCUMENTS_HOOKS_DIRECTORY_PATH,
	]);
}

export function resolveSkillsConfigSearchPaths(
	workspacePath?: string,
): string[] {
	return dedupePaths([
		...getWorkspaceSkillDirectories(workspacePath),
		join(resolveClineDataDir(), "settings", SKILLS_CONFIG_DIRECTORY_NAME),
		join(homedir(), ".cline", "skills"),
		join(homedir(), ".agents", "skills"),
	]);
}

export function resolveRulesConfigSearchPaths(
	workspacePath?: string,
): string[] {
	return dedupePaths([
		workspacePath ? join(workspacePath, ".clinerules") : "",
		join(resolveClineDataDir(), "settings", RULES_CONFIG_DIRECTORY_NAME),
		DOCUMENTS_RULES_DIRECTORY_PATH,
	]);
}

export function resolveWorkflowsConfigSearchPaths(
	workspacePath?: string,
): string[] {
	return dedupePaths([
		workspacePath ? join(workspacePath, ".clinerules", "workflows") : "",
		join(resolveClineDataDir(), "settings", WORKFLOWS_CONFIG_DIRECTORY_NAME),
		DOCUMENTS_WORKFLOWS_DIRECTORY_PATH,
	]);
}
