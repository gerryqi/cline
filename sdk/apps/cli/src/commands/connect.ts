import { getConnector, listConnectors } from "../connectors/registry";
import type { ConnectIo, ConnectStopResult } from "../connectors/types";
import { getCliBuildInfo } from "../utils/common";

function isHelpFlag(value: string | undefined): boolean {
	return value === "-h" || value === "--help";
}

async function runStopAllConnectors(io: ConnectIo): Promise<number> {
	let stoppedProcesses = 0;
	let stoppedSessions = 0;
	let executed = 0;
	for (const connector of listConnectors()) {
		if (!connector.stopAll) {
			continue;
		}
		executed += 1;
		const result = await connector.stopAll(io);
		stoppedProcesses += result.stoppedProcesses;
		stoppedSessions += result.stoppedSessions;
	}
	if (executed === 0) {
		io.writeln("[connect] no adapters support stop yet");
		return 0;
	}
	io.writeln(
		`[connect] stopped processes=${stoppedProcesses} sessions=${stoppedSessions}`,
	);
	return 0;
}

async function runStopConnector(
	adapterName: string,
	io: ConnectIo,
): Promise<number> {
	const connector = getConnector(adapterName);
	if (!connector) {
		io.writeErr(`unknown connect adapter "${adapterName}"`);
		return 1;
	}
	if (!connector.stopAll) {
		io.writeErr(`connect adapter "${adapterName}" does not support stop`);
		return 1;
	}
	const result: ConnectStopResult = await connector.stopAll(io);
	io.writeln(
		`[connect] ${connector.name} stopped processes=${result.stoppedProcesses} sessions=${result.stoppedSessions}`,
	);
	return 0;
}

export async function runConnectCommand(
	rawArgs: string[],
	io: ConnectIo,
): Promise<number> {
	const { name } = getCliBuildInfo();
	if (rawArgs[1] === "--stop") {
		const target = rawArgs[2]?.trim().toLowerCase();
		if (!target) {
			return await runStopAllConnectors(io);
		}
		if (isHelpFlag(target)) {
			io.writeln("Usage:");
			io.writeln(`  ${name} connect --stop`);
			io.writeln(`  ${name} connect --stop <adapter>`);
			return 0;
		}
		return await runStopConnector(target, io);
	}

	const adapterName = rawArgs[1]?.trim().toLowerCase();
	if (!adapterName || isHelpFlag(adapterName)) {
		io.writeln("Usage:");
		io.writeln(`  ${name} connect <adapter> [options]`);
		io.writeln(`  ${name} connect --stop [adapter]`);
		io.writeln("");
		io.writeln("Adapters:");
		for (const connector of listConnectors()) {
			io.writeln(`  ${connector.name.padEnd(12)} ${connector.description}`);
		}
		return 0;
	}

	const connector = getConnector(adapterName);
	if (!connector) {
		io.writeErr(`unknown connect adapter "${adapterName}"`);
		return 1;
	}
	return connector.run(rawArgs, io);
}
