import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, isAbsolute, resolve } from "node:path";
import type {
	AgentEvent,
	AgentResult,
	ToolApprovalRequest,
	ToolApprovalResult,
} from "@cline/agents";
import {
	CoreSessionService,
	createSessionHost,
	RpcCoreSessionService,
	type SessionManifest,
	SqliteSessionStore,
} from "@cline/core/server";
import { getRpcServerHealth, RpcSessionClient } from "@cline/rpc";
import type {
	RpcChatMessage,
	RpcChatRunTurnRequest,
	RpcChatStartSessionRequest,
	RpcChatTurnResult,
} from "@cline/shared";
import { resolveSessionDataDir } from "@cline/shared/storage";

const DEFAULT_RPC_ADDRESS =
	process.env.CLINE_RPC_ADDRESS?.trim() || "127.0.0.1:4317";
let activeRpcAddress = DEFAULT_RPC_ADDRESS;

let coreSessions: RpcCoreSessionService | undefined;
let localSessions: CoreSessionService | undefined;
let initPromise:
	| Promise<RpcCoreSessionService | CoreSessionService>
	| undefined;

export interface CliSessionManager {
	start(input: {
		config: import("@cline/core/server").CoreSessionConfig;
		source?: import("@cline/core/server").SessionSource;
		prompt?: string;
		interactive?: boolean;
		initialMessages?: import("@cline/llms").providers.Message[];
		userImages?: string[];
		userFiles?: string[];
		userInstructionWatcher?: import("@cline/core/server").UserInstructionConfigWatcher;
		onTeamRestored?: () => void;
		defaultToolExecutors?: Partial<import("@cline/core/server").ToolExecutors>;
		toolPolicies?: import("@cline/agents").AgentConfig["toolPolicies"];
		requestToolApproval?: (
			request: import("@cline/agents").ToolApprovalRequest,
		) => Promise<import("@cline/agents").ToolApprovalResult>;
	}): Promise<{
		sessionId: string;
		manifest: SessionManifest;
		manifestPath: string;
		transcriptPath: string;
		hookPath: string;
		messagesPath: string;
		result?: AgentResult;
	}>;
	send(input: {
		sessionId: string;
		prompt: string;
		userImages?: string[];
		userFiles?: string[];
	}): Promise<AgentResult | undefined>;
	readMessages(
		sessionId: string,
	): Promise<import("@cline/llms").providers.Message[]>;
	abort(sessionId: string): Promise<void>;
	stop(sessionId: string): Promise<void>;
	dispose(reason?: string): Promise<void>;
	subscribe(listener: (event: unknown) => void): () => void;
}

function isLikelyScriptEntryPath(pathValue: string | undefined): boolean {
	if (!pathValue) {
		return false;
	}
	return /\.(?:[cm]?[jt]s|tsx?)$/i.test(pathValue);
}

function startRpcServerInBackground(address: string): void {
	const launcher = process.argv[0];
	const entry = process.argv[1];
	const startArgs = ["rpc", "start", "--address", address];
	const args =
		entry && isLikelyScriptEntryPath(entry) ? [entry, ...startArgs] : startArgs;

	const child = spawn(launcher, args, {
		detached: true,
		stdio: "ignore",
		env: process.env,
		cwd: process.cwd(),
	});
	child.unref();
}

function parseEnsureAddress(stdout: string): string | undefined {
	const lines = stdout
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		const line = lines[index];
		if (!line.startsWith("{")) {
			continue;
		}
		try {
			const parsed = JSON.parse(line) as { address?: unknown };
			if (typeof parsed.address === "string" && parsed.address.trim()) {
				return parsed.address.trim();
			}
		} catch {
			// ignore non-JSON lines
		}
	}
	return undefined;
}

function ensureRpcAddressViaCli(requestedAddress: string): string | undefined {
	const launcher = process.argv[0];
	const entry = process.argv[1];
	const ensureArgs = ["rpc", "ensure", "--address", requestedAddress, "--json"];
	const args =
		entry && isLikelyScriptEntryPath(entry)
			? [entry, ...ensureArgs]
			: ensureArgs;
	const result = spawnSync(launcher, args, {
		encoding: "utf8",
		env: process.env,
		cwd: process.cwd(),
	});
	if (result.status !== 0) {
		return undefined;
	}
	return parseEnsureAddress(result.stdout || "");
}

async function tryConnectRpcSessions(
	address: string,
): Promise<RpcCoreSessionService | undefined> {
	try {
		const health = await getRpcServerHealth(address);
		if (!health) {
			return undefined;
		}
		return new RpcCoreSessionService({
			address,
			sessionsDir: resolveSessionDataDir(),
		});
	} catch {
		return undefined;
	}
}

async function getCoreSessions(): Promise<
	RpcCoreSessionService | CoreSessionService
> {
	if (coreSessions) {
		return coreSessions;
	}
	if (localSessions) {
		return localSessions;
	}
	if (!initPromise) {
		initPromise = (async () => {
			const ensuredAddress =
				ensureRpcAddressViaCli(activeRpcAddress) || activeRpcAddress;
			activeRpcAddress = ensuredAddress;
			process.env.CLINE_RPC_ADDRESS = ensuredAddress;

			const existingRpcSessions = await tryConnectRpcSessions(ensuredAddress);
			if (existingRpcSessions) {
				coreSessions = existingRpcSessions;
				return coreSessions;
			}

			// No healthy RPC server was detected; spawn one in the background.
			try {
				startRpcServerInBackground(ensuredAddress);
			} catch {
				// Ignore launch failures and fall back to local storage.
			}

			// Give the detached RPC process a brief chance to bind.
			for (let attempt = 0; attempt < 5; attempt += 1) {
				const rpcSessions = await tryConnectRpcSessions(ensuredAddress);
				if (rpcSessions) {
					coreSessions = rpcSessions;
					return coreSessions;
				}
				await new Promise((resolve) => setTimeout(resolve, 100));
			}

			// Fallback when background RPC launch is unavailable.
			localSessions = new CoreSessionService(new SqliteSessionStore());
			return localSessions;
		})();
	}
	return await initPromise;
}

export async function getCoreSessionBackend(): Promise<
	RpcCoreSessionService | CoreSessionService
> {
	return getCoreSessions();
}

export async function createDefaultCliSessionManager(options?: {
	defaultToolExecutors?: Partial<import("@cline/core/server").ToolExecutors>;
	toolPolicies?: import("@cline/agents").AgentConfig["toolPolicies"];
	requestToolApproval?: (
		request: ToolApprovalRequest,
	) => Promise<ToolApprovalResult>;
}): Promise<CliSessionManager> {
	const sessionBackend = await getCoreSessions();
	if (sessionBackend instanceof RpcCoreSessionService) {
		return createRpcRuntimeCliSessionManager(options, sessionBackend);
	}
	return (await createSessionHost({
		sessionService: sessionBackend,
		defaultToolExecutors: options?.defaultToolExecutors,
		toolPolicies: options?.toolPolicies,
		requestToolApproval: options?.requestToolApproval,
	})) as CliSessionManager;
}

type StartSessionInput = Parameters<CliSessionManager["start"]>[0];
type StartSessionOutput = Awaited<ReturnType<CliSessionManager["start"]>>;

type ListenerEvent = {
	type: "agent_event";
	payload: {
		sessionId: string;
		event: AgentEvent;
	};
};

function isUnimplementedRpcMethodError(error: unknown): boolean {
	if (error && typeof error === "object" && "code" in error) {
		const code = Number((error as { code?: unknown }).code);
		if (code === 12) {
			return true;
		}
	}
	const message = error instanceof Error ? error.message : String(error);
	return message.toUpperCase().includes("UNIMPLEMENTED");
}

function emitAgentEvent(
	listeners: Set<(event: unknown) => void>,
	sessionId: string,
	event: AgentEvent,
): void {
	const payload: ListenerEvent = {
		type: "agent_event",
		payload: {
			sessionId,
			event,
		},
	};
	for (const listener of listeners) {
		listener(payload);
	}
}

function toRpcStartRequest(
	input: StartSessionInput,
	defaultToolPolicies: StartSessionInput["toolPolicies"] | undefined,
): RpcChatStartSessionRequest {
	const config = input.config;
	const request: RpcChatStartSessionRequest = {
		workspaceRoot: config.workspaceRoot ?? config.cwd,
		cwd: config.cwd,
		provider: config.providerId,
		model: config.modelId,
		mode: config.mode,
		apiKey: config.apiKey ?? "",
		systemPrompt: config.systemPrompt,
		maxIterations: config.maxIterations,
		enableTools: config.enableTools,
		enableSpawn: config.enableSpawnAgent,
		enableTeams: config.enableAgentTeams,
		autoApproveTools:
			(input.toolPolicies ?? defaultToolPolicies)?.["*"]?.autoApprove !== false,
		teamName: config.teamName ?? "",
		missionStepInterval: config.missionLogIntervalSteps ?? 3,
		missionTimeIntervalMs: config.missionLogIntervalMs ?? 120000,
		initialMessages: input.initialMessages as RpcChatMessage[] | undefined,
	};
	(
		request as RpcChatStartSessionRequest & {
			toolPolicies?: Record<
				string,
				{ enabled?: boolean; autoApprove?: boolean }
			>;
		}
	).toolPolicies = (input.toolPolicies ?? defaultToolPolicies) as
		| Record<string, { enabled?: boolean; autoApprove?: boolean }>
		| undefined;
	return request;
}

function toAgentResult(
	result: RpcChatTurnResult,
	config: RpcChatStartSessionRequest,
): AgentResult {
	const now = new Date();
	return {
		text: result.text,
		usage: result.usage,
		iterations: result.iterations,
		finishReason: result.finishReason as AgentResult["finishReason"],
		messages: result.messages as AgentResult["messages"],
		toolCalls: result.toolCalls as AgentResult["toolCalls"],
		durationMs: 0,
		model: {
			id: config.model,
			provider: config.provider,
		},
		startedAt: now,
		endedAt: now,
	};
}

function parseEventPayload(payloadJson: string): Record<string, unknown> {
	if (!payloadJson.trim()) {
		return {};
	}
	try {
		return JSON.parse(payloadJson) as Record<string, unknown>;
	} catch {
		return {};
	}
}

function parseToolApprovalInput(inputJson: unknown): unknown {
	if (typeof inputJson !== "string" || !inputJson.trim()) {
		return undefined;
	}
	try {
		return JSON.parse(inputJson);
	} catch {
		return undefined;
	}
}

function resolveAttachmentPath(filePath: string, cwd: string): string {
	return isAbsolute(filePath) ? filePath : resolve(cwd, filePath);
}

async function toRpcAttachmentFiles(
	userFiles: string[] | undefined,
	cwd: string,
): Promise<Array<{ name: string; content: string }> | undefined> {
	if (!userFiles || userFiles.length === 0) {
		return undefined;
	}

	const files = await Promise.all(
		userFiles.map(async (filePath) => {
			const absolutePath = resolveAttachmentPath(filePath, cwd);
			return {
				name: basename(filePath),
				content: await readFile(absolutePath, "utf8"),
			};
		}),
	);
	return files.length > 0 ? files : undefined;
}

function resolveTextDelta(
	payload: Record<string, unknown>,
	streamedText: string,
): {
	delta: string;
	nextText: string;
} {
	const accumulated =
		typeof payload.accumulated === "string" ? payload.accumulated : undefined;
	if (typeof accumulated === "string") {
		if (accumulated.startsWith(streamedText)) {
			return {
				delta: accumulated.slice(streamedText.length),
				nextText: accumulated,
			};
		}
		if (streamedText.startsWith(accumulated)) {
			return {
				delta: "",
				nextText: streamedText,
			};
		}
	}

	const text = typeof payload.text === "string" ? payload.text : "";
	return {
		delta: text,
		nextText: `${streamedText}${text}`,
	};
}

function createRpcRuntimeCliSessionManager(
	options:
		| {
				defaultToolExecutors?: Partial<
					import("@cline/core/server").ToolExecutors
				>;
				toolPolicies?: import("@cline/agents").AgentConfig["toolPolicies"];
				requestToolApproval?: (
					request: ToolApprovalRequest,
				) => Promise<ToolApprovalResult>;
		  }
		| undefined,
	rpcSessions: RpcCoreSessionService,
): CliSessionManager {
	const listeners = new Set<(event: unknown) => void>();
	const client = new RpcSessionClient({ address: activeRpcAddress });
	const sessionConfigs = new Map<string, RpcChatStartSessionRequest>();

	return {
		start: async (input) => {
			const request = toRpcStartRequest(input, options?.toolPolicies);
			const response = await client.startRuntimeSession(
				JSON.stringify(request),
			);
			const sessionId = response.sessionId.trim();
			if (!sessionId) {
				throw new Error("rpc runtime start returned empty session id");
			}
			sessionConfigs.set(sessionId, request);
			const startResultRaw = response.startResultJson.trim();
			if (!startResultRaw) {
				throw new Error("rpc runtime start returned no session metadata");
			}
			return JSON.parse(startResultRaw) as StartSessionOutput;
		},
		send: async (input) => {
			const config = sessionConfigs.get(input.sessionId);
			if (!config) {
				throw new Error(`session not found: ${input.sessionId}`);
			}
			const attachmentFiles = await toRpcAttachmentFiles(
				input.userFiles,
				config.cwd ?? process.cwd(),
			);
			const request: RpcChatRunTurnRequest = {
				config,
				prompt: input.prompt,
				attachments:
					(input.userImages && input.userImages.length > 0) || attachmentFiles
						? {
								userImages:
									input.userImages && input.userImages.length > 0
										? input.userImages
										: undefined,
								userFiles: attachmentFiles,
							}
						: undefined,
			};
			let streamedText = "";
			const stopStreaming = client.streamEvents(
				{
					clientId: `cli-runtime-${process.pid}`,
					sessionIds: [input.sessionId],
				},
				{
					onEvent: (event) => {
						const payload = parseEventPayload(event.payloadJson);
						if (event.eventType === "approval.requested") {
							const approvalId =
								typeof payload.approvalId === "string"
									? payload.approvalId.trim()
									: "";
							const toolCallId =
								typeof payload.toolCallId === "string"
									? payload.toolCallId
									: "";
							const toolName =
								typeof payload.toolName === "string" ? payload.toolName : "";
							if (!approvalId || !toolCallId || !toolName) {
								return;
							}
							const inputValue = parseToolApprovalInput(payload.inputJson);
							const requestApproval = options?.requestToolApproval;
							void (async () => {
								const decision = requestApproval
									? await requestApproval({
											agentId: "",
											conversationId: "",
											iteration: 0,
											toolCallId,
											toolName,
											input: inputValue,
											policy: {},
										})
									: {
											approved: false,
											reason: `Tool "${toolName}" requires approval but no approval handler is configured`,
										};
								await client.respondToolApproval({
									approvalId,
									approved: decision.approved === true,
									reason: decision.reason,
									responderClientId: `cli-runtime-${process.pid}`,
								});
							})().catch(() => {
								// Best effort: do not fail turn streaming on approval transport errors.
							});
							return;
						}
						if (event.eventType === "runtime.chat.text_delta") {
							const resolved = resolveTextDelta(payload, streamedText);
							if (!resolved.delta) {
								streamedText = resolved.nextText;
								return;
							}
							streamedText = resolved.nextText;
							emitAgentEvent(listeners, input.sessionId, {
								type: "content_start",
								contentType: "text",
								text: resolved.delta,
							});
							return;
						}
						if (event.eventType === "runtime.chat.tool_call_start") {
							emitAgentEvent(listeners, input.sessionId, {
								type: "content_start",
								contentType: "tool",
								toolCallId:
									typeof payload.toolCallId === "string"
										? payload.toolCallId
										: undefined,
								toolName:
									typeof payload.toolName === "string"
										? payload.toolName
										: undefined,
								input: payload.input,
							} as unknown as AgentEvent);
							return;
						}
						if (event.eventType === "runtime.chat.tool_call_end") {
							emitAgentEvent(listeners, input.sessionId, {
								type: "content_end",
								contentType: "tool",
								toolCallId:
									typeof payload.toolCallId === "string"
										? payload.toolCallId
										: undefined,
								toolName:
									typeof payload.toolName === "string"
										? payload.toolName
										: undefined,
								output: payload.output,
								error:
									typeof payload.error === "string" ? payload.error : undefined,
								durationMs:
									typeof payload.durationMs === "number"
										? payload.durationMs
										: undefined,
							} as unknown as AgentEvent);
						}
					},
				},
			);
			const response = await client
				.sendRuntimeSession(input.sessionId, JSON.stringify(request))
				.finally(() => {
					stopStreaming();
				});
			const resultRaw = response.resultJson.trim();
			if (!resultRaw) {
				throw new Error("rpc runtime send returned empty result");
			}
			const result = JSON.parse(resultRaw) as RpcChatTurnResult;
			if (result.text) {
				if (result.text.startsWith(streamedText)) {
					const remainder = result.text.slice(streamedText.length);
					if (remainder) {
						emitAgentEvent(listeners, input.sessionId, {
							type: "content_start",
							contentType: "text",
							text: remainder,
						});
						streamedText += remainder;
					}
				} else if (result.text !== streamedText) {
					emitAgentEvent(listeners, input.sessionId, {
						type: "content_start",
						contentType: "text",
						text: result.text,
					});
					streamedText = result.text;
				}
			}
			if (streamedText) {
				emitAgentEvent(listeners, input.sessionId, {
					type: "content_end",
					contentType: "text",
				});
			}
			emitAgentEvent(listeners, input.sessionId, {
				type: "done",
				reason: result.finishReason,
				iterations: result.iterations,
			} as unknown as AgentEvent);
			return toAgentResult(result, config);
		},
		readMessages: async (sessionId) => {
			const row = await client.getSession(sessionId);
			const path = row?.messagesPath?.trim();
			if (!path || !existsSync(path)) {
				return [];
			}
			try {
				const raw = readFileSync(path, "utf8");
				if (!raw.trim()) {
					return [];
				}
				const parsed = JSON.parse(raw) as { messages?: unknown[] } | unknown[];
				const messages = Array.isArray(parsed)
					? parsed
					: Array.isArray(parsed.messages)
						? parsed.messages
						: [];
				return messages as import("@cline/llms").providers.Message[];
			} catch {
				return [];
			}
		},
		abort: async (sessionId) => {
			await client.abortRuntimeSession(sessionId);
		},
		stop: async (sessionId) => {
			try {
				await client.stopRuntimeSession(sessionId);
			} catch (error) {
				if (!isUnimplementedRpcMethodError(error)) {
					throw error;
				}
			}
			sessionConfigs.delete(sessionId);
		},
		dispose: async () => {
			const sessionIds = [...sessionConfigs.keys()];
			await Promise.allSettled(
				sessionIds.map(async (sessionId) => {
					try {
						await client.stopRuntimeSession(sessionId);
					} catch {
						// Best-effort cleanup.
					}
					try {
						await rpcSessions.updateSessionStatus(sessionId, "cancelled", null);
					} catch {
						// Best-effort cleanup.
					}
					sessionConfigs.delete(sessionId);
				}),
			);
			client.close();
		},
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}

export async function listSessions(limit = 200): Promise<unknown[]> {
	return await (await getCoreSessions()).listSessions(limit);
}

export async function deleteSession(
	sessionId: string,
): Promise<{ deleted: boolean }> {
	return await (await getCoreSessions()).deleteSession(sessionId);
}
