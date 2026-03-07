import { randomUUID } from "node:crypto";
import {
	CoreSessionService,
	DefaultSessionManager,
	SqliteSessionStore,
} from "@cline/core/server";
import type { providers as LlmsProviders } from "@cline/llms";
import type { RpcRuntimeHandlers } from "@cline/rpc";
import { RpcSessionClient } from "@cline/rpc";
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

	return {
		startSession: async (requestJson) => {
			const config = parseStartPayload(requestJson);
			applyHomeDir(config);
			const sessionId = `${Date.now()}_${randomUUID().slice(0, 5)}`;
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
			sessionModes.set(started.sessionId, startedConfig.mode);
			activeSessions.add(started.sessionId);
			return {
				sessionId: started.sessionId,
				startResultJson: JSON.stringify(started),
			};
		},
		sendSession: async (sessionId, requestJson) => {
			const request = parseSendPayload(requestJson);
			applyHomeDir(request.config);
			const input = request.prompt.trim();
			const userImages = request.attachments?.userImages ?? [];
			const fileMaterialized = await materializeUserFiles(
				request.attachments?.userFiles,
			);

			try {
				const result = await sessionManager.send({
					sessionId,
					prompt: input,
					userImages,
					userFiles: fileMaterialized.paths,
				});
				if (!result) {
					throw new Error("runtime send returned no result");
				}
				return { resultJson: JSON.stringify(toRpcTurnResult(result)) };
			} catch (error) {
				if (!shouldRestoreSession(error)) {
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
				sessionModes.set(sessionId, restoredConfig.mode);
				activeSessions.add(sessionId);
				const restoredResult = await sessionManager.send({
					sessionId,
					prompt: input,
					userImages,
					userFiles: fileMaterialized.paths,
				});
				if (!restoredResult) {
					throw new Error("runtime send returned no result after restore");
				}
				return { resultJson: JSON.stringify(toRpcTurnResult(restoredResult)) };
			} finally {
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
			return { applied: known };
		},
		stopSession: async (sessionId) => {
			const id = sessionId.trim();
			if (!id) {
				return { applied: false };
			}
			const known = activeSessions.has(id);
			await sessionManager.stop(id);
			activeSessions.delete(id);
			sessionModes.delete(id);
			return { applied: known };
		},
		runProviderAction: async (requestJson) => runProviderAction(requestJson),
		runProviderOAuthLogin: async (provider) => runProviderOAuthLogin(provider),
		dispose: async () => {
			unsubscribeEventBridge();
			await sessionManager.dispose("rpc_runtime_shutdown");
			activeSessions.clear();
			sessionModes.clear();
			eventClient.close();
		},
	};
}
