import { getClineDefaultSystemPrompt } from "@cline/agents";
import {
	enrichPromptWithMentions,
	generateWorkspaceInfo,
	resolveWorkflowSlashCommandFromWatcher,
	type UserInstructionConfigWatcher,
} from "@cline/core/server";

export async function buildWorkspaceInfo(cwd: string): Promise<string> {
	const workspaceInfo = await generateWorkspaceInfo(cwd);
	const workspaceConfig = {
		workspaces: {
			[workspaceInfo.rootPath]: {
				hint: workspaceInfo.hint,
				associatedRemoteUrls: workspaceInfo.associatedRemoteUrls,
				latestGitCommitHash: workspaceInfo.latestGitCommitHash,
				latestGitBranchName: workspaceInfo.latestGitBranchName,
			},
		},
	};
	return `# Workspace Configuration\n${JSON.stringify(workspaceConfig, null, 2)}`;
}

export async function buildDefaultSystemPrompt(
	cwd: string,
	rules = "",
): Promise<string> {
	const workspace = await buildWorkspaceInfo(cwd);
	return getClineDefaultSystemPrompt("Terminal Shell", cwd, workspace, rules);
}

export async function buildUserInputMessage(
	rawPrompt: string,
	mode: "act" | "plan",
	cwd: string,
	userInstructionWatcher?: UserInstructionConfigWatcher,
): Promise<string> {
	const resolvedPrompt = userInstructionWatcher
		? resolveWorkflowSlashCommandFromWatcher(rawPrompt, userInstructionWatcher)
		: rawPrompt;
	const enriched = await enrichPromptWithMentions(resolvedPrompt, cwd);
	return `<user_input mode="${mode}">${enriched.prompt}</user_input>`;
}
