import type { RpcChatTurnResult, RpcProviderModel } from "@cline/shared";

export type WebviewInboundMessage =
	| { type: "ready" }
	| {
			type: "send";
			prompt: string;
			config?: {
				provider?: string;
				model?: string;
				systemPrompt?: string;
				maxIterations?: number;
				enableTools?: boolean;
				enableSpawn?: boolean;
				enableTeams?: boolean;
				autoApproveTools?: boolean;
			};
	  }
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
			usage?: RpcChatTurnResult["usage"];
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
	| { type: "models"; providerId: string; models: RpcProviderModel[] }
	| {
			type: "defaults";
			defaults: {
				provider?: string;
				model?: string;
				workspaceRoot: string;
				cwd: string;
			};
	  }
	| { type: "reset_done" };
