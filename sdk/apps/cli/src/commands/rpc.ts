import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { createSqliteRpcSessionBackend } from "@cline/core/server";
import {
	getRpcServerHealth,
	RpcSessionClient,
	registerRpcClient,
	requestRpcServerShutdown,
	startRpcServer,
	stopRpcServer,
} from "@cline/rpc";
import { createRpcRuntimeHandlers } from "./rpc-runtime";

const c = {
	dim: "\x1b[2m",
	reset: "\x1b[0m",
};

function parseRpcAddress(address: string): { host: string; port: number } {
	const trimmed = address.trim();
	const idx = trimmed.lastIndexOf(":");
	if (idx <= 0 || idx >= trimmed.length - 1) {
		throw new Error(`invalid rpc address: ${address}`);
	}
	const host = trimmed.slice(0, idx);
	const port = Number.parseInt(trimmed.slice(idx + 1), 10);
	if (!Number.isInteger(port) || port <= 0 || port > 65535) {
		throw new Error(`invalid rpc port in address: ${address}`);
	}
	return { host, port };
}

function resolveRpcAddress(rawArgs: string[]): string {
	const addressIndex = rawArgs.indexOf("--address");
	const address =
		(addressIndex >= 0 && addressIndex + 1 < rawArgs.length
			? rawArgs[addressIndex + 1]
			: process.env.CLINE_RPC_ADDRESS) || "127.0.0.1:4317";
	return address.trim();
}

function resolveArgValue(rawArgs: string[], flag: string): string | undefined {
	const flagIndex = rawArgs.indexOf(flag);
	if (flagIndex < 0 || flagIndex + 1 >= rawArgs.length) {
		return undefined;
	}
	const value = rawArgs[flagIndex + 1]?.trim();
	return value ? value : undefined;
}

function resolveRpcMetadata(rawArgs: string[]): Record<string, string> {
	const metadata: Record<string, string> = {};
	for (let index = 0; index < rawArgs.length; index += 1) {
		if (rawArgs[index] !== "--meta" || index + 1 >= rawArgs.length) {
			continue;
		}
		const raw = rawArgs[index + 1]?.trim() || "";
		const separator = raw.indexOf("=");
		if (separator <= 0 || separator >= raw.length - 1) {
			continue;
		}
		const key = raw.slice(0, separator).trim();
		const value = raw.slice(separator + 1).trim();
		if (!key || !value) {
			continue;
		}
		metadata[key] = value;
	}
	return metadata;
}

function isUnimplementedError(error: unknown): boolean {
	if (error && typeof error === "object" && "code" in error) {
		const code = Number((error as { code?: unknown }).code);
		if (code === 12) {
			return true;
		}
	}
	const message = error instanceof Error ? error.message : String(error);
	return message.toUpperCase().includes("UNIMPLEMENTED");
}

async function hasRuntimeMethods(address: string): Promise<boolean> {
	const client = new RpcSessionClient({ address });
	try {
		const probeRequest = {
			workspaceRoot: process.cwd(),
			cwd: process.cwd(),
			provider: "cline",
			model: "openai/gpt-5.3-codex",
			mode: "act",
			apiKey: "",
			enableTools: false,
			enableSpawn: false,
			enableTeams: false,
			autoApproveTools: true,
			teamName: "rpc-probe",
			missionStepInterval: 3,
			missionTimeIntervalMs: 120000,
		};
		const started = await client.startRuntimeSession(
			JSON.stringify(probeRequest),
		);
		if (!started.sessionId.trim() || !started.startResultJson.trim()) {
			return false;
		}
		try {
			await client.stopRuntimeSession(started.sessionId);
			await client.deleteSession(started.sessionId, true);
		} catch {
			// best effort cleanup
		}
		return true;
	} catch (error) {
		return !isUnimplementedError(error);
	} finally {
		client.close();
	}
}

async function isPortFree(host: string, port: number): Promise<boolean> {
	return await new Promise<boolean>((resolve) => {
		const server = createServer();
		server.once("error", () => resolve(false));
		server.once("listening", () => {
			server.close(() => resolve(true));
		});
		server.listen({ host, port });
	});
}

async function findAvailableAddress(baseAddress: string): Promise<string> {
	const { host, port } = parseRpcAddress(baseAddress);
	for (let offset = 1; offset <= 40; offset += 1) {
		const candidatePort = port + offset;
		if (candidatePort > 65535) {
			break;
		}
		if (await isPortFree(host, candidatePort)) {
			return `${host}:${candidatePort}`;
		}
	}
	throw new Error(`no available rpc port near ${baseAddress}`);
}

function spawnRpcStartDetached(address: string): void {
	const launcher = process.argv[0];
	const entry = process.argv[1];
	if (!entry) {
		throw new Error("unable to resolve CLI entrypoint for detached rpc start");
	}
	const child = spawn(launcher, [entry, "rpc", "start", "--address", address], {
		detached: true,
		stdio: "ignore",
		env: process.env,
		cwd: process.cwd(),
	});
	child.unref();
}

function forceKillListener(address: string): number {
	const { port } = parseRpcAddress(address);
	if (process.platform === "win32") {
		const list = spawnSync("cmd", ["/c", "netstat -ano -p tcp"], {
			encoding: "utf8",
		});
		if (list.status !== 0) {
			return 0;
		}
		const pids = new Set<number>();
		for (const line of (list.stdout || "").split(/\r?\n/)) {
			if (!line.includes(`:${port}`) || !line.includes("LISTENING")) {
				continue;
			}
			const parts = line.trim().split(/\s+/);
			const pid = Number.parseInt(parts[parts.length - 1] || "", 10);
			if (Number.isInteger(pid) && pid > 0) {
				pids.add(pid);
			}
		}
		for (const pid of pids) {
			spawnSync("taskkill", ["/PID", String(pid), "/F"], { encoding: "utf8" });
		}
		return pids.size;
	}

	const out = spawnSync("lsof", ["-nP", `-tiTCP:${port}`, "-sTCP:LISTEN"], {
		encoding: "utf8",
	});
	if (out.status !== 0) {
		return 0;
	}
	const pids = (out.stdout || "")
		.split(/\r?\n/)
		.map((line) => Number.parseInt(line.trim(), 10))
		.filter((pid) => Number.isInteger(pid) && pid > 0);
	for (const pid of pids) {
		try {
			process.kill(pid, "SIGKILL");
		} catch {
			// best effort
		}
	}
	return pids.length;
}

async function waitForRuntimeReady(address: string): Promise<boolean> {
	for (let attempt = 0; attempt < 60; attempt += 1) {
		const health = await getRpcServerHealth(address);
		if (health?.running && (await hasRuntimeMethods(address))) {
			return true;
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	return false;
}

async function ensureCompatibleRpcAddress(
	requestedAddress: string,
	options?: { forceKillIncompatible?: boolean },
): Promise<{ address: string; action: "reuse" | "new-port" | "started" }> {
	const health = await getRpcServerHealth(requestedAddress);
	if (!health?.running) {
		return { address: requestedAddress, action: "started" };
	}
	if (await hasRuntimeMethods(requestedAddress)) {
		return { address: requestedAddress, action: "reuse" };
	}

	if (options?.forceKillIncompatible) {
		const shutdown = await requestRpcServerShutdown(requestedAddress);
		if (shutdown?.accepted) {
			for (let attempt = 0; attempt < 20; attempt += 1) {
				if (!(await getRpcServerHealth(requestedAddress))?.running) {
					return { address: requestedAddress, action: "started" };
				}
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
		}
		forceKillListener(requestedAddress);
		if (!(await getRpcServerHealth(requestedAddress))?.running) {
			return { address: requestedAddress, action: "started" };
		}
	}

	return {
		address: await findAvailableAddress(requestedAddress),
		action: "new-port",
	};
}

export async function runRpcEnsureCommand(
	rawArgs: string[],
	writeln: (text?: string) => void,
	writeErr: (text: string) => void,
): Promise<number> {
	const requestedAddress = resolveRpcAddress(rawArgs);
	const jsonOutput = rawArgs.includes("--json");
	const ensured = await ensureCompatibleRpcAddress(requestedAddress, {
		forceKillIncompatible: true,
	});

	if (ensured.action !== "reuse") {
		spawnRpcStartDetached(ensured.address);
	}

	if (!(await waitForRuntimeReady(ensured.address))) {
		writeErr(`failed to ensure rpc runtime at ${ensured.address}`);
		return 1;
	}

	if (jsonOutput) {
		writeln(
			JSON.stringify({
				running: true,
				requestedAddress,
				address: ensured.address,
				action: ensured.action,
			}),
		);
	} else {
		writeln(
			`${c.dim}[rpc] ensured address=${ensured.address} (requested=${requestedAddress}, action=${ensured.action})${c.reset}`,
		);
	}
	return 0;
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

	const ensured = await ensureCompatibleRpcAddress(normalizedAddress);
	const startAddress = ensured.address;
	if (ensured.action === "reuse") {
		const existing = await getRpcServerHealth(startAddress);
		writeln(
			`${c.dim}[rpc] already running server_id=${existing?.serverId ?? "unknown"} address=${startAddress}${c.reset}`,
		);
		return 0;
	}

	process.env.CLINE_RPC_ADDRESS = startAddress;
	const handle = await startRpcServer({
		address: startAddress,
		sessionBackend: createSqliteRpcSessionBackend(),
		runtimeHandlers: createRpcRuntimeHandlers(),
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

function formatUptime(startedAt: string): string {
	const startMs = new Date(startedAt).getTime();
	if (!Number.isFinite(startMs)) {
		return "unknown";
	}
	let seconds = Math.floor((Date.now() - startMs) / 1000);
	if (seconds < 0) {
		return "0s";
	}
	const days = Math.floor(seconds / 86400);
	seconds %= 86400;
	const hours = Math.floor(seconds / 3600);
	seconds %= 3600;
	const minutes = Math.floor(seconds / 60);
	seconds %= 60;
	const parts: string[] = [];
	if (days > 0) {
		parts.push(`${days}d`);
	}
	if (hours > 0) {
		parts.push(`${hours}h`);
	}
	if (minutes > 0) {
		parts.push(`${minutes}m`);
	}
	parts.push(`${seconds}s`);
	return parts.join(" ");
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
	const jsonOutput = rawArgs.includes("--json");

	const health = await getRpcServerHealth(normalizedAddress);
	if (!health?.running) {
		if (jsonOutput) {
			writeln(
				JSON.stringify({
					running: false,
					address: normalizedAddress,
				}),
			);
		} else {
			writeln(
				`${c.dim}[rpc] not running address=${normalizedAddress}${c.reset}`,
			);
		}
		return 1;
	}

	const uptime = health.startedAt ? formatUptime(health.startedAt) : "unknown";

	if (jsonOutput) {
		writeln(
			JSON.stringify({
				running: true,
				serverId: health.serverId,
				address: health.address,
				startedAt: health.startedAt || null,
				uptime,
			}),
		);
	} else {
		writeln(
			`${c.dim}[rpc] running server_id=${health.serverId} address=${health.address} uptime=${uptime}${c.reset}`,
		);
	}
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

export async function runRpcRegisterCommand(
	rawArgs: string[],
	writeln: (text?: string) => void,
	writeErr: (text: string) => void,
): Promise<number> {
	const normalizedAddress = resolveRpcAddress(rawArgs);
	if (!normalizedAddress) {
		writeErr("rpc register requires a non-empty address");
		return 1;
	}

	const clientType = resolveArgValue(rawArgs, "--client-type") || "desktop";
	const requestedClientId = resolveArgValue(rawArgs, "--client-id");
	const metadata = resolveRpcMetadata(rawArgs);

	const registration = await registerRpcClient(normalizedAddress, {
		clientId: requestedClientId,
		clientType,
		metadata,
	});
	if (!registration?.registered) {
		writeErr(
			`failed to register client with rpc server at ${normalizedAddress}`,
		);
		return 1;
	}

	writeln(
		`${c.dim}[rpc] registered client_id=${registration.clientId} address=${normalizedAddress}${c.reset}`,
	);
	return 0;
}
