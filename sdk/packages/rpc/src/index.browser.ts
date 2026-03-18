function browserOnlyError(): Error {
	return new Error(
		"@clinebot/rpc is Node-only. Use @clinebot/rpc/node in Node runtimes.",
	);
}

export class RpcSessionClient {
	constructor() {
		throw browserOnlyError();
	}
}
export type { RpcStreamTeamProgressHandlers } from "./client.js";

export class RpcRuntimeChatClient {
	constructor() {
		throw browserOnlyError();
	}
}

export async function runRpcRuntimeEventBridge(): Promise<never> {
	throw browserOnlyError();
}
export async function runRpcRuntimeCommandBridge(): Promise<never> {
	throw browserOnlyError();
}

export type {
	RpcRuntimeEvent,
	RpcRuntimeStreamStop,
} from "./runtime-chat-client.js";
export type {
	RpcRuntimeBridgeCommand,
	RpcRuntimeBridgeCommandOutputLine,
	RpcRuntimeBridgeRequestEnvelope,
	RpcRuntimeBridgeResponseEnvelope,
} from "./runtime-chat-command-bridge.js";
export type {
	RpcRuntimeBridgeControlLine,
	RpcRuntimeBridgeOutputLine,
} from "./runtime-chat-stream-bridge.js";

export function getRpcServerHandle(): never {
	throw browserOnlyError();
}

export async function getRpcServerHealth(): Promise<never> {
	throw browserOnlyError();
}

export async function startRpcServer(_options: unknown): Promise<never> {
	throw browserOnlyError();
}

export async function stopRpcServer(): Promise<never> {
	throw browserOnlyError();
}

export type {
	PendingApproval,
	RoutedEvent,
	RpcServerHandle,
	RpcServerOptions,
	RpcSessionBackend,
	RpcSessionRow,
	RpcSessionStatus,
	RpcSessionUpdateInput,
	RpcSpawnQueueItem,
} from "./types.js";
