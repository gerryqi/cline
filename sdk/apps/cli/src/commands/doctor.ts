import { spawnSync } from "node:child_process";
import { getRpcServerDefaultAddress, getRpcServerHealth } from "@clinebot/rpc";

type DoctorIo = {
	writeln: (text?: string) => void;
	writeErr: (text: string) => void;
};

type DoctorStatus = {
	rpcAddress: string;
	rpcHealthy: boolean;
	rpcServerId?: string;
	listeningPids: number[];
	staleCliPids: number[];
};

function resolveRpcAddress(rawArgs: string[]): string {
	const addressIndex = rawArgs.indexOf("--address");
	const address =
		(addressIndex >= 0 && addressIndex + 1 < rawArgs.length
			? rawArgs[addressIndex + 1]
			: process.env.CLINE_RPC_ADDRESS) || getRpcServerDefaultAddress();
	return address.trim();
}

function parsePids(raw: string): number[] {
	return raw
		.split(/\r?\n/)
		.map((line) => Number.parseInt(line.trim(), 10))
		.filter((pid) => Number.isInteger(pid) && pid > 0);
}

function parseRpcPort(address: string): number | undefined {
	const idx = address.lastIndexOf(":");
	if (idx <= 0 || idx >= address.length - 1) {
		return undefined;
	}
	const port = Number.parseInt(address.slice(idx + 1), 10);
	return Number.isInteger(port) && port > 0 ? port : undefined;
}

function listListeningPids(address: string): number[] {
	const port = parseRpcPort(address);
	if (!port) {
		return [];
	}
	if (process.platform === "win32") {
		return [];
	}
	const result = spawnSync("lsof", ["-nP", `-tiTCP:${port}`, "-sTCP:LISTEN"], {
		encoding: "utf8",
	});
	if (result.status !== 0) {
		return [];
	}
	return parsePids(result.stdout);
}

function listStaleCliPids(): number[] {
	if (process.platform === "win32") {
		return [];
	}
	const patterns = [
		"/apps/cli/src/index.ts",
		"/apps/cli/dist/index.js",
		"/dist/clite",
	];
	const pids = new Set<number>();
	for (const pattern of patterns) {
		const result = spawnSync("pgrep", ["-f", pattern], { encoding: "utf8" });
		if (result.status !== 0 && result.status !== 1) {
			continue;
		}
		for (const pid of parsePids(result.stdout)) {
			if (pid !== process.pid && pid !== process.ppid) {
				pids.add(pid);
			}
		}
	}
	return [...pids].sort((a, b) => a - b);
}

async function collectDoctorStatus(address: string): Promise<DoctorStatus> {
	const health = await getRpcServerHealth(address);
	return {
		rpcAddress: address,
		rpcHealthy: health?.running === true,
		rpcServerId: health?.serverId,
		listeningPids: listListeningPids(address),
		staleCliPids: listStaleCliPids(),
	};
}

function formatPidList(label: string, pids: number[]): string {
	if (pids.length === 0) {
		return `${label}: none`;
	}
	return `${label}: ${pids.join(", ")}`;
}

function killPids(pids: number[]): number {
	let killed = 0;
	for (const pid of pids) {
		try {
			process.kill(pid, "SIGKILL");
			killed += 1;
		} catch {
			// Best-effort cleanup.
		}
	}
	return killed;
}

export async function runDoctorCommand(
	rawArgs: string[],
	io: DoctorIo,
): Promise<number> {
	const jsonOutput = rawArgs.includes("--json");
	const fix = rawArgs.includes("--fix");
	const address = resolveRpcAddress(rawArgs);
	const before = await collectDoctorStatus(address);

	if (!fix) {
		if (jsonOutput) {
			io.writeln(JSON.stringify(before));
			return 0;
		}
		io.writeln(`rpc address: ${before.rpcAddress}`);
		io.writeln(
			`rpc healthy: ${before.rpcHealthy ? "yes" : "no"}${before.rpcServerId ? ` (${before.rpcServerId})` : ""}`,
		);
		io.writeln(formatPidList("rpc listeners", before.listeningPids));
		io.writeln(formatPidList("cli processes", before.staleCliPids));
		if (before.listeningPids.length > 0 || before.staleCliPids.length > 0) {
			io.writeln(
				"Run `clite doctor --fix` to kill stale local RPC/CLI processes.",
			);
		}
		return 0;
	}

	const killedRpc = killPids(before.listeningPids);
	const staleCliTargets = before.staleCliPids.filter(
		(pid) => !before.listeningPids.includes(pid),
	);
	const killedCli = killPids(staleCliTargets);
	const after = await collectDoctorStatus(address);

	if (jsonOutput) {
		io.writeln(
			JSON.stringify({
				before,
				after,
				killed: {
					rpcListeners: killedRpc,
					cliProcesses: killedCli,
				},
			}),
		);
		return 0;
	}

	io.writeln(`killed rpc listeners: ${killedRpc}`);
	io.writeln(`killed cli processes: ${killedCli}`);
	io.writeln(`rpc healthy after fix: ${after.rpcHealthy ? "yes" : "no"}`);
	io.writeln(formatPidList("remaining rpc listeners", after.listeningPids));
	io.writeln(formatPidList("remaining cli processes", after.staleCliPids));
	return 0;
}
