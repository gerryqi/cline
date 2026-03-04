import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
	Agent,
	type AgentEvent,
	getClineDefaultSystemPrompt,
} from "@cline/agents";
import {
	DefaultRuntimeBuilder,
	enrichPromptWithMentions,
	generateWorkspaceInfo,
} from "@cline/core/server";
import type { providers as LlmsProviders } from "@cline/llms";
import { providers } from "@cline/llms";

type Message = LlmsProviders.Message;

type StartSessionRequest = {
	workspaceRoot: string;
	cwd?: string;
	provider: string;
	model: string;
	mode?: "act" | "plan";
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
};

type ChatRunTurnRequest = {
	config: StartSessionRequest;
	messages?: Message[];
	prompt: string;
	attachments?: {
		userImages?: string[];
		userFiles?: Array<{
			name: string;
			content: string;
		}>;
	};
};

type ChatToolCallResult = {
	name: string;
	input?: unknown;
	output?: unknown;
	error?: string;
	durationMs?: number;
};

type ChatTurnResult = {
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
	messages: Message[];
	toolCalls: ChatToolCallResult[];
};

type ChatStreamLine =
	| {
			type: "chunk";
			stream: "chat_text";
			chunk: string;
	  }
	| {
			type: "tool_call_start";
			toolCallId: string;
			toolName: string;
			input: unknown;
	  }
	| {
			type: "tool_call_end";
			toolCallId: string;
			toolName: string;
			output: unknown;
			error?: string;
			durationMs: number;
	  }
	| {
			type: "result";
			result: ChatTurnResult;
	  };

function readStdin(): string {
	return readFileSync(0, "utf8");
}

function toPromptMessage(
	message: string,
	mode: "act" | "plan" = "act",
): string {
	return `<user_input mode="${mode}">${message}</user_input>`;
}

function toMessageHistory(messages: Message[] | undefined): Message[] {
	if (!Array.isArray(messages) || messages.length === 0) {
		return [];
	}
	return messages;
}

function writeStreamLine(line: ChatStreamLine): void {
	process.stdout.write(`${JSON.stringify(line)}\n`);
}

let cachedDesktopApprovalRequester:
	| Promise<
			(request: {
				toolCallId: string;
				toolName: string;
				input?: unknown;
				iteration?: number;
				agentId?: string;
				conversationId?: string;
			}) => Promise<{ approved: boolean; reason?: string }>
	  >
	| undefined;

async function requestDesktopToolApproval(request: {
	toolCallId: string;
	toolName: string;
	input?: unknown;
	iteration?: number;
	agentId?: string;
	conversationId?: string;
}): Promise<{ approved: boolean; reason?: string }> {
	if (!cachedDesktopApprovalRequester) {
		cachedDesktopApprovalRequester = import("@cline/core/server")
			.then((module) => {
				const fn = (
					module as {
						requestDesktopToolApproval?: (request: {
							toolCallId: string;
							toolName: string;
							input?: unknown;
							iteration?: number;
							agentId?: string;
							conversationId?: string;
						}) => Promise<{ approved: boolean; reason?: string }>;
					}
				).requestDesktopToolApproval;
				if (typeof fn !== "function") {
					throw new Error(
						"Installed @cline/core does not expose requestDesktopToolApproval",
					);
				}
				return fn;
			})
			.catch(() => {
				return async () => ({
					approved: false,
					reason: "Desktop tool approval IPC is not available",
				});
			});
	}
	const requester = await cachedDesktopApprovalRequester;
	return requester(request);
}

function sanitizeFilename(name: string, index: number): string {
	const base = basename(name || `attachment-${index + 1}`);
	return base.replace(/[^\w.-]+/g, "_");
}

async function materializeUserFiles(
	files: Array<{ name: string; content: string }> | undefined,
): Promise<{ tempDir?: string; paths: string[] }> {
	if (!files || files.length === 0) {
		return { paths: [] };
	}

	const resolvedTempDir = await mkdtemp(`${tmpdir()}/cline-app-attachments-`);
	const paths: string[] = [];

	for (const [index, file] of files.entries()) {
		const safeName = sanitizeFilename(file.name, index);
		const path = join(resolvedTempDir, safeName);
		await writeFile(path, file.content, "utf8");
		paths.push(path);
	}

	return { tempDir: resolvedTempDir, paths };
}

async function resolveSystemPrompt(
	config: StartSessionRequest,
	cwd: string,
): Promise<string> {
	const explicit = config.systemPrompt?.trim();
	if (explicit) {
		return explicit;
	}
	const workspaceInfo = await generateWorkspaceInfo(cwd);
	return getClineDefaultSystemPrompt(
		"Terminal Shell",
		cwd,
		JSON.stringify(workspaceInfo, null, 2),
	);
}

async function main() {
	const raw = readStdin();
	const parsed = JSON.parse(raw) as ChatRunTurnRequest;

	const apiKey = parsed.config.apiKey?.trim() || undefined;
	const cwd = (parsed.config.cwd?.trim() || parsed.config.workspaceRoot).trim();
	const providerId = providers.normalizeProviderId(parsed.config.provider);
	const systemPrompt = await resolveSystemPrompt(parsed.config, cwd);
	const history = toMessageHistory(parsed.messages);
	const mode = parsed.config.mode ?? "act";

	const runtime = new DefaultRuntimeBuilder().build({
		config: {
			providerId,
			modelId: parsed.config.model,
			mode,
			apiKey,
			cwd,
			workspaceRoot: parsed.config.workspaceRoot,
			systemPrompt,
			maxIterations: parsed.config.maxIterations ?? 10,
			enableTools: parsed.config.enableTools,
			enableSpawnAgent: parsed.config.enableSpawn,
			enableAgentTeams: parsed.config.enableTeams,
			teamName: parsed.config.teamName,
			missionLogIntervalSteps: parsed.config.missionStepInterval,
			missionLogIntervalMs: parsed.config.missionTimeIntervalMs,
		},
	});

	const agent = new Agent({
		providerId,
		modelId: parsed.config.model,
		apiKey,
		systemPrompt,
		maxIterations: parsed.config.maxIterations ?? 10,
		tools: runtime.tools,
		toolPolicies: {
			"*": {
				autoApprove: parsed.config.autoApproveTools !== false,
			},
		},
		requestToolApproval: requestDesktopToolApproval,
		onEvent: (event: AgentEvent) => {
			if (
				event.type === "content_start" &&
				event.contentType === "text" &&
				event.text
			) {
				writeStreamLine({
					type: "chunk",
					stream: "chat_text",
					chunk: event.text,
				});
				return;
			}
			if (event.type === "content_start" && event.contentType === "tool") {
				writeStreamLine({
					type: "tool_call_start",
					toolCallId: event.toolCallId ?? "",
					toolName: event.toolName ?? "unknown_tool",
					input: event.input,
				});
				return;
			}
			if (event.type === "content_end" && event.contentType === "tool") {
				writeStreamLine({
					type: "tool_call_end",
					toolCallId: event.toolCallId ?? "",
					toolName: event.toolName ?? "unknown_tool",
					output: event.output,
					error: event.error,
					durationMs: event.durationMs ?? 0,
				});
			}
		},
	});

	if (history.length > 0) {
		(agent as unknown as { messages: Message[] }).messages = [...history];
	}

	const enriched = await enrichPromptWithMentions(parsed.prompt, cwd);
	const input = toPromptMessage(enriched.prompt, mode);
	const userImages = parsed.attachments?.userImages ?? [];
	const fileMaterialized = await materializeUserFiles(
		parsed.attachments?.userFiles,
	);
	const result = await (history.length > 0
		? agent.continue(input, userImages, fileMaterialized.paths)
		: agent.run(input, userImages, fileMaterialized.paths)
	).finally(async () => {
		await runtime.shutdown("chat_turn_complete");
		if (fileMaterialized.tempDir) {
			try {
				await rm(fileMaterialized.tempDir, { recursive: true, force: true });
			} catch {
				// best effort cleanup
			}
		}
	});

	writeStreamLine({
		type: "result",
		result: {
			text: result.text,
			usage: result.usage,
			inputTokens: result.usage.inputTokens,
			outputTokens: result.usage.outputTokens,
			iterations: result.iterations,
			finishReason: result.finishReason,
			messages: result.messages,
			toolCalls: result.toolCalls.map((call) => ({
				name: call.name,
				input: call.input,
				output: call.output,
				error: call.error,
				durationMs: call.durationMs,
			})),
		},
	});
}

main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(message);
	process.exit(1);
});
