import { createSqliteRpcSessionBackend } from "@cline/core/server";
import {
	getRpcServerHealth,
	requestRpcServerShutdown,
	startRpcServer,
	stopRpcServer,
} from "@cline/rpc";

const c = {
	dim: "\x1b[2m",
	reset: "\x1b[0m",
};

function resolveRpcAddress(rawArgs: string[]): string {
	const addressIndex = rawArgs.indexOf("--address");
	const address =
		(addressIndex >= 0 && addressIndex + 1 < rawArgs.length
			? rawArgs[addressIndex + 1]
			: process.env.CLINE_RPC_ADDRESS) || "127.0.0.1:4317";
	return address.trim();
}

export async function runRpcStartCommand(
	rawArgs: string[],
	writeln: (text?: string) => void,
	writeErr: (text: string) => void,
): Promise<number> {
	const normalizedAddress = resolveRpcAddress(rawArgs);
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

	const handle = await startRpcServer({
		address: normalizedAddress,
		sessionBackend: createSqliteRpcSessionBackend(),
	});
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

export async function runRpcStatusCommand(
	rawArgs: string[],
	writeln: (text?: string) => void,
	writeErr: (text: string) => void,
): Promise<number> {
	const normalizedAddress = resolveRpcAddress(rawArgs);
	if (!normalizedAddress) {
		writeErr("rpc status requires a non-empty address");
		return 1;
	}

	const health = await getRpcServerHealth(normalizedAddress);
	if (!health?.running) {
		writeln(`${c.dim}[rpc] not running address=${normalizedAddress}${c.reset}`);
		return 1;
	}

	writeln(
		`${c.dim}[rpc] running server_id=${health.serverId} address=${health.address}${c.reset}`,
	);
	return 0;
}

export async function runRpcStopCommand(
	rawArgs: string[],
	writeln: (text?: string) => void,
	writeErr: (text: string) => void,
): Promise<number> {
	const normalizedAddress = resolveRpcAddress(rawArgs);
	if (!normalizedAddress) {
		writeErr("rpc stop requires a non-empty address");
		return 1;
	}

	const health = await getRpcServerHealth(normalizedAddress);
	if (!health?.running) {
		writeln(`${c.dim}[rpc] not running address=${normalizedAddress}${c.reset}`);
		return 0;
	}

	const shutdown = await requestRpcServerShutdown(normalizedAddress);
	if (!shutdown?.accepted) {
		writeErr(
			`failed to request rpc shutdown at ${normalizedAddress} (server may have exited)`,
		);
		return 1;
	}

	// Wait briefly for the server to unbind so follow-up calls can trust the result.
	for (let attempt = 0; attempt < 10; attempt += 1) {
		const nextHealth = await getRpcServerHealth(normalizedAddress);
		if (!nextHealth?.running) {
			writeln(
				`${c.dim}[rpc] stopped server_id=${health.serverId} address=${health.address}${c.reset}`,
			);
			return 0;
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}

	writeErr(
		`rpc shutdown requested but server still reports healthy at ${health.address}`,
	);
	return 1;
}
