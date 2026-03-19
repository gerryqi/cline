import { createServer } from "node:net";
import type { HostContext } from "./types";

export function createHostContext(workspaceRoot: string): HostContext {
	return {
		liveSessions: new Map(),
		wsClients: new Set(),
		pendingBridge: new Map(),
		bridgeChild: null,
		bridgeReady: false,
		bridgeRequestId: 0,
		approvalWatcher: null,
		approvalBroadcastTimer: null,
		workspaceRoot,
		rpcAddress: "",
	};
}

export function nowMs(): number {
	return Date.now();
}

export function jsonResponse(
	id: string,
	ok: boolean,
	result?: unknown,
	error?: string,
): string {
	return JSON.stringify({
		type: "response",
		id,
		ok,
		result,
		error,
	});
}

export function sendEvent(ctx: HostContext, name: string, payload: unknown) {
	const encoded = JSON.stringify({
		type: "event",
		event: { name, payload },
	});
	for (const client of ctx.wsClients) {
		try {
			client.send(encoded);
		} catch {
			ctx.wsClients.delete(client);
		}
	}
}

export async function findAvailablePort(): Promise<number> {
	return await new Promise((resolve, reject) => {
		const server = createServer();
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (!address || typeof address === "string") {
				server.close();
				reject(new Error("failed to reserve local host port"));
				return;
			}
			const port = address.port;
			server.close((error) => {
				if (error) {
					reject(error);
					return;
				}
				resolve(port);
			});
		});
		server.on("error", reject);
	});
}
