import type { DesktopTransportRequest } from "../lib/desktop-transport";
import { handleCommand } from "./commands";
import { bootstrapRpcGateway, resolveWorkspaceRoot } from "./paths";
import {
	broadcastApprovalSnapshots,
	ensureApprovalWatcher,
} from "./runtime-bridge";
import {
	createHostContext,
	findAvailablePort,
	jsonResponse,
	sendEvent,
} from "./state";
import { BunRuntime, DEFAULT_RPC_ADDRESS, HOST_MODE } from "./types";

async function main() {
	if (!BunRuntime) {
		throw new Error("apps/code host must be run with Bun");
	}

	const ctx = createHostContext(resolveWorkspaceRoot(process.cwd()));
	if (process.env.CLINE_CODE_HOST_SKIP_RPC_BOOTSTRAP === "1") {
		ctx.rpcAddress =
			process.env.CLINE_RPC_ADDRESS?.trim() || DEFAULT_RPC_ADDRESS;
	} else {
		bootstrapRpcGateway(ctx);
	}

	ensureApprovalWatcher(ctx);
	const port = await findAvailablePort();
	const host = BunRuntime.serve({
		hostname: "127.0.0.1",
		port,
		fetch(req: Request, server: any) {
			const url = new URL(req.url);
			if (url.pathname === "/health") {
				return new Response(
					JSON.stringify({
						ok: true,
						rpcAddress: ctx.rpcAddress,
						mode: HOST_MODE,
						pid: process.pid,
					}),
					{
						headers: { "content-type": "application/json" },
					},
				);
			}
			if (url.pathname === "/transport" && server.upgrade(req)) {
				return undefined;
			}
			return new Response("Not found", { status: 404 });
		},
		websocket: {
			open(ws: any) {
				ctx.wsClients.add(ws);
				sendEvent(ctx, "host_ready", {
					pid: process.pid,
					mode: HOST_MODE,
					rpcAddress: ctx.rpcAddress,
				});
				broadcastApprovalSnapshots(ctx);
			},
			async message(ws: any, raw: string) {
				let request: DesktopTransportRequest;
				try {
					request = JSON.parse(String(raw)) as DesktopTransportRequest;
				} catch {
					ws.send(
						jsonResponse(
							"",
							false,
							undefined,
							"invalid desktop transport payload",
						),
					);
					return;
				}
				try {
					const result = await handleCommand(
						ctx,
						request.command,
						request.args,
					);
					ws.send(jsonResponse(request.id, true, result));
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error);
					ws.send(jsonResponse(request.id, false, undefined, message));
				}
			},
			close(ws: any) {
				ctx.wsClients.delete(ws);
			},
		},
	});

	const endpoint = `http://127.0.0.1:${host.port}`;
	const wsEndpoint = `ws://127.0.0.1:${host.port}/transport`;
	process.stdout.write(
		`${JSON.stringify({
			type: "ready",
			endpoint,
			wsEndpoint,
			pid: process.pid,
			mode: HOST_MODE,
		})}\n`,
	);
}

main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`${message}\n`);
	process.exit(1);
});
