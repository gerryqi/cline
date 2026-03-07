import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { type DefaultSessionManager, SessionSource } from "@cline/core/server";
import type { providers as LlmsProviders } from "@cline/llms";
import { providers } from "@cline/llms";
import type {
	RpcChatMessage,
	RpcChatRunTurnRequest,
	RpcChatRuntimeConfigBase,
	RpcChatStartSessionRequest,
	RpcChatTurnResult,
} from "@cline/shared";
import { setHomeDir, setHomeDirIfUnset } from "@cline/shared/storage";
import { resolveSystemPrompt } from "../../runtime/prompt";

function sanitizeFilename(name: string, index: number): string {
	const base = basename(name || `attachment-${index + 1}`);
	return base.replace(/[^\w.-]+/g, "_");
}

export async function materializeUserFiles(
	files: Array<{ name: string; content: string }> | undefined,
): Promise<{ tempDir?: string; paths: string[] }> {
	if (!files || files.length === 0) {
		return { paths: [] };
	}

	const resolvedTempDir = await mkdtemp(`${tmpdir()}/cline-rpc-attachments-`);
	const paths: string[] = [];
	for (const [index, file] of files.entries()) {
		const safeName = sanitizeFilename(file.name, index);
		const path = join(resolvedTempDir, safeName);
		await writeFile(path, file.content, "utf8");
		paths.push(path);
	}
	return { tempDir: resolvedTempDir, paths };
}

export async function cleanupMaterializedFiles(
	tempDir?: string,
): Promise<void> {
	if (!tempDir) {
		return;
	}
	try {
		await rm(tempDir, {
			recursive: true,
			force: true,
		});
	} catch {
		// best effort cleanup
	}
}

function resolveMode(config: RpcChatStartSessionRequest): "act" | "plan" {
	return config.mode === "plan" ? "plan" : "act";
}

function resolveSessionCwd(config: RpcChatStartSessionRequest): string {
	return (config.cwd?.trim() || config.workspaceRoot).trim();
}

function resolveToolPolicies(
	config: RpcChatStartSessionRequest,
): RpcChatRuntimeConfigBase["toolPolicies"] {
	const explicit = config.toolPolicies;
	if (explicit) {
		return explicit;
	}
	return {
		"*": {
			autoApprove: config.autoApproveTools !== false,
		},
	};
}

export async function buildSessionStartInput(input: {
	config: RpcChatStartSessionRequest;
	sessionId?: string;
	initialMessages?: LlmsProviders.Message[];
}): Promise<{
	mode: "act" | "plan";
	sessionInput: Parameters<DefaultSessionManager["start"]>[0];
}> {
	const { config } = input;
	const mode = resolveMode(config);
	const cwd = resolveSessionCwd(config);
	const providerId = providers.normalizeProviderId(config.provider);
	const systemPrompt = await resolveSystemPrompt({
		cwd,
		explicitSystemPrompt: config.systemPrompt,
		rules: config.rules,
	});

	return {
		mode,
		sessionInput: {
			source: SessionSource.DESKTOP_CHAT,
			interactive: true,
			initialMessages: input.initialMessages,
			config: {
				...(input.sessionId ? { sessionId: input.sessionId } : {}),
				providerId,
				modelId: config.model,
				mode,
				apiKey: config.apiKey?.trim() || undefined,
				cwd,
				workspaceRoot: config.workspaceRoot,
				systemPrompt,
				maxIterations: config.maxIterations ?? 10,
				enableTools: config.enableTools,
				enableSpawnAgent: config.enableSpawn,
				enableAgentTeams: config.enableTeams,
				teamName: config.teamName,
				missionLogIntervalSteps: config.missionStepInterval,
				missionLogIntervalMs: config.missionTimeIntervalMs,
			},
			toolPolicies: resolveToolPolicies(config),
		},
	};
}

export function applyHomeDir(config: RpcChatStartSessionRequest): void {
	const homeDir = config.sessions?.homeDir?.trim();
	if (homeDir) {
		setHomeDir(homeDir);
		return;
	}
	setHomeDirIfUnset(homedir());
}

export function parseStartPayload(
	requestJson: string,
): RpcChatStartSessionRequest {
	return JSON.parse(requestJson) as RpcChatStartSessionRequest;
}

export function parseSendPayload(requestJson: string): RpcChatRunTurnRequest {
	return JSON.parse(requestJson) as RpcChatRunTurnRequest;
}

function toRpcMessages(messages: LlmsProviders.Message[]): RpcChatMessage[] {
	return messages as unknown as RpcChatMessage[];
}

export function toRpcTurnResult(result: {
	text: string;
	usage: {
		inputTokens: number;
		outputTokens: number;
		totalCost?: number;
	};
	iterations: number;
	finishReason: string;
	messages: LlmsProviders.Message[];
	toolCalls: Array<{
		name: string;
		input: unknown;
		output: unknown;
		error?: string;
		durationMs?: number;
	}>;
}): RpcChatTurnResult {
	return {
		text: result.text,
		usage: result.usage,
		inputTokens: result.usage.inputTokens,
		outputTokens: result.usage.outputTokens,
		iterations: result.iterations,
		finishReason: result.finishReason,
		messages: toRpcMessages(result.messages),
		toolCalls: result.toolCalls.map((call) => ({
			name: call.name,
			input: call.input,
			output: call.output,
			error: call.error,
			durationMs: call.durationMs,
		})),
	};
}

export function shouldRestoreSession(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error ?? "");
	return message.includes("session not found");
}
