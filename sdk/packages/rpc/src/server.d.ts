import type { HealthResponse } from "./proto/generated/cline/rpc/v1/HealthResponse.js";
import type { RpcServerHandle, RpcServerOptions } from "./types.js";
export declare function getRpcServerHealth(
	address: string,
): Promise<HealthResponse | undefined>;
export declare function startRpcServer(
	options: RpcServerOptions,
): Promise<RpcServerHandle>;
export declare function getRpcServerHandle(): RpcServerHandle | undefined;
export declare function stopRpcServer(): Promise<void>;
