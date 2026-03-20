import { randomUUID } from "node:crypto";
import {
	CoreSessionService,
	DefaultSessionManager,
	SqliteSessionStore,
} from "@clinebot/core/node";
import type { providers as LlmsProviders } from "@clinebot/llms";
import { type RpcRuntimeHandlers, RpcSessionClient } from "@clinebot/rpc";
import {
	createCliLoggerAdapter,
	flushCliLoggerAdapters,
} from "../logging/adapter";
import {
	createRpcToolApprovalRequester,
	subscribeRuntimeEventBridge,
} from "./rpc-runtime/event-bridge";
import {
	runProviderAction,
	runProviderOAuthLogin,
} from "./rpc-runtime/provider-actions";
import {
	applyHomeDir,
	buildSessionStartInput,
	cleanupMaterializedFiles,
	materializeUserFiles,
	parseSendPayload,
	parseStartPayload,
	shouldRestoreSession,
	toRpcTurnResult,
} from "./rpc-runtime/session-helpers";

const RPC_RUNTIME_NAME = "rpc-runtime";
const RPC_SESSION_COMPONENT = "rpc-runtime-session";

export function createRpcRuntimeHandlers(): RpcRuntimeHandlers {
	const sessionManager = new DefaultSessionManager({
		distinctId: process.pid.toString(),
		sessionService: new CoreSessionService(new SqliteSessionStore()),
	});
	const sessionModes = new Map<string, "act" | "plan">();
	const activeSessions = new Set<string>();
	const rpcAddress = process.env.CLINE_RPC_ADDRESS?.trim() || "127.0.0.1:4317";
	const eventClient = new RpcSessionClient({ address: rpcAddress });
	const runtimeClientId = `cli-rpc-runtime-${process.pid}`;
	const unsubscribeEventBridge = subscribeRuntimeEventBridge({
		sessionManager,
		eventClient,
	});
	const cleanupFailedSession = async (
		sessionId: string,
		runtimeLogger: ReturnType<typeof createCliLoggerAdapter>["core"],
		reason: string,
	): Promise<void> => {
		try {
			await sessionManager.stop(sessionId);
		} catch (stopError) {
			runtimeLogger.warn?.("RPC runtime failed-session cleanup errored", {
				sessionId,
				reason,
				error: stopError,
			});
		} finally {
			activeSessions.delete(sessionId);
			sessionModes.delete(sessionId);
		}
	};
	const stopTrackedSessions = async (
		shutdownReason: "rpc_runtime_dispose" | "rpc_runtime_shutdown",
	): Promise<void> => {
		const sessionIds = [...activeSessions];
		await Promise.allSettled(
			sessionIds.map(async (sessionId) => {
				try {
					await sessionManager.abort(sessionId);
				} catch {
					// Best-effort abort before stop.
				}
				try {
					await sessionManager.stop(sessionId);
				} catch {
					// Best-effort stop during runtime teardown.
				}
			}),
		);
		if (shutdownReason === "rpc_runtime_shutdown") {
			activeSessions.clear();
			sessionModes.clear();
		}
	};

	return {
		startSession: async (request) => {
			const config = parseStartPayload(request);
			applyHomeDir(config);
			const runtimeLogger = createCliLoggerAdapter({
				runtime: RPC_RUNTIME_NAME,
				component: RPC_SESSION_COMPONENT,
				runtimeConfig: config.logger,
			}).core;
			const sessionId =
				config.sessionId?.trim() || `${Date.now()}_${randomUUID().slice(0, 5)}`;
			const startedConfig = await buildSessionStartInput({
				config,
				sessionId,
				initialMessages: config.initialMessages as
					| LlmsProviders.Message[]
					| undefined,
			});
			startedConfig.sessionInput.requestToolApproval =
				createRpcToolApprovalRequester({
					eventClient,
					runtimeClientId,
					sessionId,
				});
			const started = await sessionManager.start(startedConfig.sessionInput);
			runtimeLogger.info?.("RPC runtime session started", {
				sessionId: started.sessionId,
				mode: startedConfig.mode,
			});
			sessionModes.set(started.sessionId, startedConfig.mode);
			activeSessions.add(started.sessionId);
			return {
				sessionId: started.sessionId,
				startResult: {
					sessionId: started.sessionId,
					manifestPath: started.manifestPath,
					transcriptPath: started.transcriptPath,
					hookPath: started.hookPath,
					messagesPath: started.messagesPath,
				},
			};
		},
		sendSession: async (sessionId, requestInput) => {
			const request = parseSendPayload(requestInput);
			applyHomeDir(request.config);
			const runtimeLogger = createCliLoggerAdapter({
				runtime: RPC_RUNTIME_NAME,
				component: RPC_SESSION_COMPONENT,
				runtimeConfig: request.config.logger,
			}).core;
			const input = request.prompt.trim();
			const userImages = request.attachments?.userImages ?? [];
			const fileMaterialized = await materializeUserFiles(
				request.attachments?.userFiles,
			);

			try {
				runtimeLogger.debug?.("RPC runtime turn send requested", {
					sessionId,
					promptLength: input.length,
				});
				const result = await sessionManager.send({
					sessionId,
					prompt: input,
					userImages,
					userFiles: fileMaterialized.paths,
				});
				if (!result) {
					throw new Error("runtime send returned no result");
				}
				runtimeLogger.info?.("RPC runtime turn send completed", {
					sessionId,
					finishReason: result.finishReason,
					iterations: result.iterations,
				});
				return { result: toRpcTurnResult(result) };
			} catch (error) {
				if (!shouldRestoreSession(error)) {
					runtimeLogger.error?.("RPC runtime turn send failed", { error });
					await cleanupFailedSession(
						sessionId,
						runtimeLogger,
						"send_failed_non_restorable",
					);
					throw error;
				}

				const restoredConfig = await buildSessionStartInput({
					config: request.config,
					sessionId,
					initialMessages: request.messages as unknown as
						| LlmsProviders.Message[]
						| undefined,
				});
				await sessionManager.start(restoredConfig.sessionInput);
				runtimeLogger.warn?.(
					"RPC runtime session restored after missing session",
					{
						sessionId,
					},
				);
				sessionModes.set(sessionId, restoredConfig.mode);
				activeSessions.add(sessionId);
				const restoredResult = await (async () => {
					try {
						return await sessionManager.send({
							sessionId,
							prompt: input,
							userImages,
							userFiles: fileMaterialized.paths,
						});
					} catch (restoredError) {
						runtimeLogger.error?.(
							"RPC runtime turn send failed after restore",
							{
								error: restoredError,
							},
						);
						await cleanupFailedSession(
							sessionId,
							runtimeLogger,
							"send_failed_after_restore",
						);
						throw restoredError;
					}
				})();
				if (!restoredResult) {
					await cleanupFailedSession(
						sessionId,
						runtimeLogger,
						"send_missing_result_after_restore",
					);
					throw new Error("runtime send returned no result after restore");
				}
				runtimeLogger.info?.("RPC runtime turn completed after restore", {
					sessionId,
					finishReason: restoredResult.finishReason,
					iterations: restoredResult.iterations,
				});
				return { result: toRpcTurnResult(restoredResult) };
			} finally {
				flushCliLoggerAdapters();
				await cleanupMaterializedFiles(fileMaterialized.tempDir);
			}
		},
		abortSession: async (sessionId) => {
			const id = sessionId.trim();
			if (!id) {
				return { applied: false };
			}
			const known = activeSessions.has(id);
			await sessionManager.abort(id);
			createCliLoggerAdapter({
				runtime: RPC_RUNTIME_NAME,
				component: RPC_SESSION_COMPONENT,
			}).core.info?.("RPC runtime session abort requested", {
				sessionId: id,
				known,
			});
			return { applied: known };
		},
		stopSession: async (sessionId) => {
			const id = sessionId.trim();
			if (!id) {
				return { applied: false };
			}
			const known = activeSessions.has(id);
			await sessionManager.stop(id);
			createCliLoggerAdapter({
				runtime: RPC_RUNTIME_NAME,
				component: RPC_SESSION_COMPONENT,
			}).core.info?.("RPC runtime session stopped", {
				sessionId: id,
				known,
			});
			flushCliLoggerAdapters();
			activeSessions.delete(id);
			sessionModes.delete(id);
			return { applied: known };
		},
		runProviderAction: async (request) => runProviderAction(request),
		runProviderOAuthLogin: async (provider) => runProviderOAuthLogin(provider),
		dispose: async () => {
			unsubscribeEventBridge();
			await stopTrackedSessions("rpc_runtime_shutdown");
			await sessionManager.dispose("rpc_runtime_shutdown");
			flushCliLoggerAdapters();
			activeSessions.clear();
			sessionModes.clear();
			eventClient.close();
		},
	};
}
