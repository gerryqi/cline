function browserOnlyError(): Error {
	return new Error(
		"@cline/rpc is Node-only. Use @cline/rpc/node in Node runtimes.",
	);
}

export class RpcSessionClient {
	constructor() {
		throw browserOnlyError();
	}
}

export function getRpcServerHandle(): never {
	throw browserOnlyError();
}

export async function getRpcServerHealth(): Promise<never> {
	throw browserOnlyError();
}

export async function startRpcServer(): Promise<never> {
	throw browserOnlyError();
}

export async function stopRpcServer(): Promise<never> {
	throw browserOnlyError();
}

export type { RpcSessionRow, RpcSessionStatus } from "./session-store.js";
export type {
	PendingApproval,
	RoutedEvent,
	RpcServerHandle,
	RpcServerOptions,
} from "./types.js";
