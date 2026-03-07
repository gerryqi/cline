import { getClineDefaultSystemPrompt } from "@cline/agents";
import {
	buildWorkspaceMetadata,
	resolveWorkflowSlashCommandFromWatcher,
	type UserInstructionConfigWatcher,
} from "@cline/core/server";

export async function resolveSystemPrompt(input: {
	cwd: string;
	explicitSystemPrompt?: string;
	rules?: string;
}): Promise<string> {
	const explicit = input.explicitSystemPrompt?.trim();
	if (explicit) {
		return explicit;
	}
	const workspace = await buildWorkspaceMetadata(input.cwd);
	return getClineDefaultSystemPrompt(
		"Terminal Shell",
		input.cwd,
		workspace,
		input.rules,
	);
}

export async function buildUserInputMessage(
	rawPrompt: string,
	userInstructionWatcher?: UserInstructionConfigWatcher,
): Promise<string> {
	return userInstructionWatcher
		? resolveWorkflowSlashCommandFromWatcher(rawPrompt, userInstructionWatcher)
		: rawPrompt;
}
