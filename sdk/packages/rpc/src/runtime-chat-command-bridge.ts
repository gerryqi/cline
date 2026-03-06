import { createInterface } from "node:readline";
import { RpcRuntimeChatClient } from "./runtime-chat-client.js";
import {
	createRpcRuntimeStreamRelay,
	type RpcRuntimeBridgeStreamLine,
} from "./runtime-chat-stream-relay.js";

export type RpcRuntimeBridgeCommand =
	| {
			action: "start";
			config: unknown;
	  }
	| {
			action: "send";
			sessionId: string;
			request: unknown;
	  }
	| {
			action: "abort";
			sessionId: string;
	  }
	| {
			action: "set_sessions";
			sessionIds: string[];
	  }
	| {
			action: "reset";
			sessionId?: string;
	  }
	| {
			action: "shutdown";
	  };

export type RpcRuntimeBridgeRequestEnvelope = {
	type: "request";
	requestId: string;
	command: RpcRuntimeBridgeCommand;
};

export type RpcRuntimeBridgeResponseEnvelope = {
	type: "response";
	requestId: string;
	response?: Record<string, unknown>;
	error?: string;
};

export type RpcRuntimeBridgeCommandOutputLine =
	| {
			type: "ready";
	  }
	| RpcRuntimeBridgeResponseEnvelope
	| RpcRuntimeBridgeStreamLine
	| {
			type: "error";
			sessionId?: string;
			message: string;
	  };

function parseResultPayload(raw: string): unknown {
	try {
		return JSON.parse(raw) as unknown;
	} catch {
		return raw;
	}
}

export async function runRpcRuntimeCommandBridge(options: {
	clientId: string;
	writeLine: (line: RpcRuntimeBridgeCommandOutputLine) => void;
	onBeforeStart?: (config: unknown) => void;
	onBeforeSend?: (request: unknown) => void;
	parseSendResult?: (resultRaw: string) => unknown;
}): Promise<void> {
	const client = new RpcRuntimeChatClient();
	const relay = createRpcRuntimeStreamRelay({
		client,
		clientId: options.clientId,
		writeLine: (line) => {
			options.writeLine(line);
		},
	});

	const respond = (response: RpcRuntimeBridgeResponseEnvelope): void => {
		options.writeLine(response);
	};

	const handleCommand = async (
		requestId: string,
		command: RpcRuntimeBridgeCommand,
	): Promise<boolean> => {
		if (command.action === "start") {
			options.onBeforeStart?.(command.config);
			const sessionId = await client.startSession(command.config);
			respond({
				type: "response",
				requestId,
				response: { sessionId },
			});
			return false;
		}
		if (command.action === "send") {
			options.onBeforeSend?.(command.request);
			const resultRaw = await client.sendSession(
				command.sessionId,
				command.request,
			);
			const parsedResult = options.parseSendResult
				? options.parseSendResult(resultRaw)
				: parseResultPayload(resultRaw);
			respond({
				type: "response",
				requestId,
				response: { result: parsedResult },
			});
			return false;
		}
		if (command.action === "abort") {
			const applied = await client.abortSession(command.sessionId);
			respond({
				type: "response",
				requestId,
				response: { ok: applied },
			});
			return false;
		}
		if (command.action === "set_sessions") {
			relay.applySessions(command.sessionIds ?? []);
			respond({
				type: "response",
				requestId,
				response: { ok: true },
			});
			return false;
		}
		if (command.action === "reset") {
			relay.resetSession(command.sessionId);
			respond({
				type: "response",
				requestId,
				response: { ok: true },
			});
			return false;
		}
		if (command.action === "shutdown") {
			respond({
				type: "response",
				requestId,
				response: { ok: true },
			});
			return true;
		}
		return false;
	};

	options.writeLine({ type: "ready" });

	const rl = createInterface({
		input: process.stdin,
		output: process.stderr,
		terminal: false,
	});

	try {
		for await (const line of rl) {
			const trimmed = line.trim();
			if (!trimmed) {
				continue;
			}
			let parsed: RpcRuntimeBridgeRequestEnvelope;
			try {
				parsed = JSON.parse(trimmed) as RpcRuntimeBridgeRequestEnvelope;
			} catch {
				options.writeLine({
					type: "error",
					message: "invalid bridge request json",
				});
				continue;
			}
			if (parsed.type !== "request") {
				respond({
					type: "response",
					requestId: parsed.requestId || "",
					error: "invalid bridge request envelope",
				});
				continue;
			}
			const requestId = parsed.requestId?.trim();
			if (!requestId) {
				options.writeLine({
					type: "error",
					message: "bridge request missing requestId",
				});
				continue;
			}
			try {
				const shouldShutdown = await handleCommand(requestId, parsed.command);
				if (shouldShutdown) {
					break;
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				respond({
					type: "response",
					requestId,
					error: message,
				});
			}
		}
	} finally {
		relay.stop();
		client.close();
	}
}
