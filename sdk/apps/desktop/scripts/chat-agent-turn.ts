import { readFileSync } from "node:fs";
import { Agent, createBuiltinTools } from "@cline/agents";

type StartSessionRequest = {
	workspaceRoot: string;
	cwd?: string;
	provider: string;
	model: string;
	apiKey: string;
	systemPrompt?: string;
	maxIterations?: number;
	enableTools: boolean;
	autoApproveTools?: boolean;
};

type ChatHistoryMessage = {
	role: string;
	content: string;
};

type ChatRunTurnRequest = {
	config: StartSessionRequest;
	history: ChatHistoryMessage[];
	prompt: string;
};

function readStdin(): string {
	return readFileSync(0, "utf8");
}

function toHistoryBlock(history: ChatHistoryMessage[]): string {
	if (history.length === 0) {
		return "";
	}
	const recent = history.slice(-24);
	const lines = recent.map(
		(item) =>
			`${item.role === "assistant" ? "Assistant" : "User"}: ${item.content}`,
	);
	return `Conversation so far:\n${lines.join("\n\n")}\n\n`;
}

async function main() {
	const raw = readStdin();
	const parsed = JSON.parse(raw) as ChatRunTurnRequest;

	const apiKey = parsed.config.apiKey?.trim() || undefined;

	const cwd = (parsed.config.cwd?.trim() || parsed.config.workspaceRoot).trim();
	const tools = parsed.config.enableTools
		? createBuiltinTools({
				cwd,
			})
		: [];

	const agent = new Agent({
		providerId: parsed.config.provider,
		modelId: parsed.config.model,
		apiKey,
		systemPrompt:
			parsed.config.systemPrompt?.trim() ||
			"You are Cline, an AI coding agent. Follow user requests and use tools when needed.",
		maxIterations: parsed.config.maxIterations ?? 10,
		tools,
		toolPolicies: {
			"*": {
				autoApprove: parsed.config.autoApproveTools !== false,
			},
		},
	});

	const input =
		`${toHistoryBlock(parsed.history)}User: ${parsed.prompt}`.trim();
	const result = await agent.run(input);

	process.stdout.write(
		JSON.stringify({
			text: result.text,
			inputTokens: result.usage.inputTokens,
			outputTokens: result.usage.outputTokens,
			iterations: result.iterations,
			finishReason: result.finishReason,
			toolCalls: result.toolCalls.map((call) => ({
				name: call.name,
				input: call.input,
				output: call.output,
				error: call.error,
				durationMs: call.durationMs,
			})),
		}),
	);
}

main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(message);
	process.exit(1);
});
