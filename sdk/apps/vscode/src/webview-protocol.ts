export type WebviewUsage = {
	inputTokens?: number;
	outputTokens?: number;
	cacheCreationInputTokens?: number;
	cacheReadInputTokens?: number;
	totalCost?: number;
};

export type WebviewProviderModel = {
	id: string;
	name?: string;
};

export type WebviewConfig = {
	provider?: string;
	model?: string;
	systemPrompt?: string;
	maxIterations?: number;
	enableTools?: boolean;
	enableSpawn?: boolean;
	enableTeams?: boolean;
	autoApproveTools?: boolean;
};

export type WebviewDefaults = {
	provider?: string;
	model?: string;
	workspaceRoot: string;
	cwd: string;
};

export type WebviewInboundMessage =
	| { type: "ready" }
	| { type: "send"; prompt: string; config?: WebviewConfig }
	| { type: "abort" }
	| { type: "reset" }
	| { type: "loadModels"; providerId: string };

export type WebviewOutboundMessage =
	| { type: "status"; text: string }
	| { type: "error"; text: string }
	| { type: "session_started"; sessionId: string }
	| { type: "assistant_delta"; text: string }
	| { type: "tool_event"; text: string }
	| {
			type: "turn_done";
			finishReason: string;
			iterations: number;
			usage?: WebviewUsage;
	  }
	| {
			type: "providers";
			providers: Array<{
				id: string;
				name: string;
				enabled: boolean;
				defaultModelId?: string;
			}>;
	  }
	| { type: "models"; providerId: string; models: WebviewProviderModel[] }
	| { type: "defaults"; defaults: WebviewDefaults }
	| { type: "reset_done" };
