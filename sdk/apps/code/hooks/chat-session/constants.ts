import { models } from "@clinebot/llms";
import type { ChatSessionConfig } from "@/lib/chat-schema";
import { readModelSelectionStorageFromWindow } from "@/lib/model-selection";

export const CHAT_TRANSPORT_UNAVAILABLE_MESSAGE =
	"Chat connection is unavailable. Reopen the app window to restore realtime chat.";
export const CHAT_WS_ENDPOINT_RETRY_ATTEMPTS = 60;
export const CHAT_WS_ENDPOINT_RETRY_DELAY_MS = 100;
export const CHAT_WS_RECONNECT_BASE_DELAY_MS = 300;
export const CHAT_WS_RECONNECT_MAX_DELAY_MS = 3000;
export const CHAT_WS_REQUEST_TIMEOUT_MS = 120000;
export const OAUTH_MANAGED_PROVIDERS = new Set([
	"cline",
	"oca",
	"openai-codex",
]);

export const DEFAULT_CHAT_CONFIG: ChatSessionConfig = {
	workspaceRoot: "",
	cwd: "",
	provider: "anthropic",
	model: models.ANTHROPIC_DEFAULT_MODEL,
	mode: "act",
	apiKey: process.env.ANTHROPIC_API_KEY || "",
	systemPrompt: undefined,
	maxIterations: undefined,
	enableTools: true,
	enableSpawn: true,
	enableTeams: true,
	autoApproveTools: true,
	teamName: "app-team",
	missionStepInterval: 3,
	missionTimeIntervalMs: 120000,
};

export function getInitialChatConfig(): ChatSessionConfig {
	const selection = readModelSelectionStorageFromWindow();
	const rememberedProvider = selection.lastProvider.trim();
	const rememberedModelForProvider = rememberedProvider
		? selection.lastModelByProvider[rememberedProvider]
		: undefined;
	const rememberedModelForDefaultProvider =
		selection.lastModelByProvider[DEFAULT_CHAT_CONFIG.provider];
	const provider = rememberedProvider || DEFAULT_CHAT_CONFIG.provider;
	const model =
		rememberedModelForProvider ||
		(provider === DEFAULT_CHAT_CONFIG.provider
			? rememberedModelForDefaultProvider
			: undefined) ||
		DEFAULT_CHAT_CONFIG.model;

	return {
		...DEFAULT_CHAT_CONFIG,
		provider,
		model,
	};
}
