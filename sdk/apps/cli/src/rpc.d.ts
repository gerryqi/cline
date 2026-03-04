declare module "@cline/rpc" {
	export interface RpcServerOptions {
		address?: string;
	}

	export interface RpcServerHandle {
		serverId: string;
		address: string;
		port: number;
		startedAt: string;
		stop: () => Promise<void>;
	}

	export function startRpcServer(
		options?: RpcServerOptions,
	): Promise<RpcServerHandle>;
	export function stopRpcServer(): Promise<void>;
	export function getRpcServerHealth(address: string): Promise<
		| {
				serverId: string;
				address: string;
				running: boolean;
		  }
		| undefined
	>;
}
