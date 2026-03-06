export type RpcAgentMode = "act" | "plan";

export interface RpcSessionStorageOptions {
	homeDir?: string;
}

export interface RpcChatStartSessionRequest {
	workspaceRoot: string;
	cwd?: string;
	provider: string;
	model: string;
	mode?: RpcAgentMode;
	apiKey: string;
	systemPrompt?: string;
	maxIterations?: number;
	enableTools: boolean;
	enableSpawn: boolean;
	enableTeams: boolean;
	autoApproveTools?: boolean;
	teamName: string;
	missionStepInterval: number;
	missionTimeIntervalMs: number;
	sessions?: RpcSessionStorageOptions;
	initialMessages?: RpcChatMessage[];
	toolPolicies?: Record<
		string,
		{
			enabled?: boolean;
			autoApprove?: boolean;
		}
	>;
}

export interface RpcChatAttachmentFile {
	name: string;
	content: string;
}

export interface RpcChatAttachments {
	userImages?: string[];
	userFiles?: RpcChatAttachmentFile[];
}

export interface RpcChatMessage {
	role?: string;
	content?: unknown;
	[key: string]: unknown;
}

export interface RpcChatRunTurnRequest {
	config: RpcChatStartSessionRequest;
	messages?: RpcChatMessage[];
	prompt: string;
	promptPreformatted?: boolean;
	attachments?: RpcChatAttachments;
}

export interface RpcChatToolCallResult {
	name: string;
	input?: unknown;
	output?: unknown;
	error?: string;
	durationMs?: number;
}

export interface RpcChatTurnResult {
	text: string;
	usage: {
		inputTokens: number;
		outputTokens: number;
		cacheReadTokens?: number;
		cacheWriteTokens?: number;
		totalCost?: number;
	};
	inputTokens: number;
	outputTokens: number;
	iterations: number;
	finishReason: string;
	messages: RpcChatMessage[];
	toolCalls: RpcChatToolCallResult[];
}

export interface RpcProviderModel {
	id: string;
	name: string;
	supportsAttachments?: boolean;
	supportsVision?: boolean;
}

export interface RpcProviderListItem {
	id: string;
	name: string;
	models: number | null;
	color: string;
	letter: string;
	enabled: boolean;
	apiKey?: string;
	baseUrl?: string;
	defaultModelId?: string;
	authDescription: string;
	baseUrlDescription: string;
}

export interface RpcProviderCatalogResponse {
	providers: RpcProviderListItem[];
	settingsPath: string;
}

export interface RpcProviderModelsResponse {
	providerId: string;
	models: RpcProviderModel[];
}

export type RpcProviderActionRequest =
	| { action: "listProviders" }
	| { action: "getProviderModels"; providerId: string }
	| {
			action: "saveProviderSettings";
			providerId: string;
			enabled?: boolean;
			apiKey?: string;
			baseUrl?: string;
	  };

export interface RpcProviderOAuthLoginResponse {
	provider: string;
	apiKey: string;
}
