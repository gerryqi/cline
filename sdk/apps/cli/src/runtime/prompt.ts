import { getClineDefaultSystemPrompt } from "@cline/agents";
import {
	buildWorkspaceMetadata,
	resolveWorkflowSlashCommandFromWatcher,
	type UserInstructionConfigWatcher,
} from "@cline/core/server";

export async function buildDefaultSystemPrompt(
	cwd: string,
	rules = "",
): Promise<string> {
	const workspace = await buildWorkspaceMetadata(cwd);
	return getClineDefaultSystemPrompt("Terminal Shell", cwd, workspace, rules);
}

export async function buildUserInputMessage(
	rawPrompt: string,
	userInstructionWatcher?: UserInstructionConfigWatcher,
): Promise<string> {
	return userInstructionWatcher
		? resolveWorkflowSlashCommandFromWatcher(rawPrompt, userInstructionWatcher)
		: rawPrompt;
}
