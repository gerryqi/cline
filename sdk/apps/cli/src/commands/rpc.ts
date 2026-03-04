import { getRpcServerHealth, startRpcServer, stopRpcServer } from "@cline/rpc";

const c = {
	dim: "\x1b[2m",
	reset: "\x1b[0m",
};

export async function runRpcStartCommand(
	rawArgs: string[],
	writeln: (text?: string) => void,
	writeErr: (text: string) => void,
): Promise<number> {
	const addressIndex = rawArgs.indexOf("--address");
	const address =
		(addressIndex >= 0 && addressIndex + 1 < rawArgs.length
			? rawArgs[addressIndex + 1]
			: process.env.CLINE_RPC_ADDRESS) || "127.0.0.1:4317";
	const normalizedAddress = address.trim();
	if (!normalizedAddress) {
		writeErr("rpc start requires a non-empty address");
		return 1;
	}

	const existing = await getRpcServerHealth(normalizedAddress);
	if (existing?.running) {
		writeln(
			`${c.dim}[rpc] already running server_id=${existing.serverId} address=${existing.address}${c.reset}`,
		);
		return 0;
	}

	const handle = await startRpcServer({ address: normalizedAddress });
	writeln(
		`${c.dim}[rpc] started server_id=${handle.serverId} address=${handle.address}${c.reset}`,
	);
	writeln(`${c.dim}[rpc] press Ctrl+C to stop${c.reset}`);

	await new Promise<void>((resolve) => {
		const shutdown = () => {
			process.off("SIGINT", shutdown);
			process.off("SIGTERM", shutdown);
			resolve();
		};
		process.on("SIGINT", shutdown);
		process.on("SIGTERM", shutdown);
	});

	await stopRpcServer();
	writeln(`${c.dim}[rpc] stopped${c.reset}`);
	return 0;
}
