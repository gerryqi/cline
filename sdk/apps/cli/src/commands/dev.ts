import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveClineDataDir } from "@clinebot/core";
import open from "open";
import { getCliBuildInfo } from "../utils/common";

type DevCommandIo = {
	writeln: (text?: string) => void;
	writeErr: (text: string) => void;
};

type RunDevCommandDeps = {
	openPath?: (target: string) => Promise<void> | void;
};

function resolveCliLogPath(): string {
	const { name } = getCliBuildInfo();
	return join(resolveClineDataDir(), "logs", `${name}.log`);
}

function ensureFileExists(filePath: string): void {
	mkdirSync(dirname(filePath), { recursive: true });
	appendFileSync(filePath, "");
}

async function defaultOpenPath(target: string): Promise<void> {
	await open(target, { wait: false });
}

export async function runDevCommand(
	rawArgs: string[],
	io: DevCommandIo,
	deps: RunDevCommandDeps = {},
): Promise<number> {
	const subcommand = rawArgs[1]?.trim().toLowerCase();
	if (subcommand !== "log") {
		io.writeErr(`unknown dev subcommand "${rawArgs[1] ?? ""}"`);
		return 1;
	}

	const logPath = resolveCliLogPath();
	const openPath = deps.openPath ?? defaultOpenPath;
	try {
		ensureFileExists(logPath);
		await openPath(logPath);
		io.writeln(logPath);
		return 0;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		io.writeErr(`failed to open log file "${logPath}": ${message}`);
		return 1;
	}
}
