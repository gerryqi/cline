export type ModelSelectionStorage = {
	lastProvider: string;
	lastModelByProvider: Record<string, string>;
};

export type ChatMessage = {
	id: string;
	role: "user" | "assistant" | "meta" | "error";
	text: string;
	toolEvents?: ToolEvent[];
};

export type ToolEvent = {
	id: string;
	toolCallId?: string;
	name: string;
	text: string;
	state: "input-available" | "output-available" | "output-error";
	input?: unknown;
	output?: unknown;
	error?: string;
};

export type ProviderOption = {
	id: string;
	name: string;
	enabled: boolean;
	defaultModelId?: string;
};
