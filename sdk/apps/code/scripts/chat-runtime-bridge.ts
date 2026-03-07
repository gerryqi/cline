import { homedir } from "node:os";
import {
	type RpcRuntimeBridgeCommandOutputLine,
	runRpcRuntimeCommandBridge,
} from "@cline/rpc";
import type { RpcChatTurnResult } from "@cline/shared";
import { setHomeDir, setHomeDirIfUnset } from "@cline/shared/storage";

function writeLine(line: RpcRuntimeBridgeCommandOutputLine): void {
	process.stdout.write(`${JSON.stringify(line)}\n`);
}

function setRuntimeHomeDir(config: unknown): void {
	if (typeof config !== "object" || config === null) {
		setHomeDirIfUnset(homedir());
		return;
	}
	const sessions = (config as { sessions?: unknown }).sessions;
	const homeDir =
		typeof sessions === "object" && sessions !== null
			? (sessions as { homeDir?: unknown }).homeDir
			: undefined;
	const normalized = typeof homeDir === "string" ? homeDir.trim() : "";
	if (normalized) {
		setHomeDir(normalized);
		return;
	}
	setHomeDirIfUnset(homedir());
}

async function main() {
	const clientId =
		process.env.CLINE_RPC_CLIENT_ID?.trim() ||
		`code-chat-runtime-bridge-${process.pid}`;
	await runRpcRuntimeCommandBridge({
		clientId,
		writeLine,
		onBeforeStart: (config) => {
			setRuntimeHomeDir(config);
		},
		onBeforeSend: (request) => {
			if (typeof request !== "object" || request === null) {
				return;
			}
			const config = (request as { config?: unknown }).config;
			setRuntimeHomeDir(config);
		},
		parseSendResult: (resultRaw) => JSON.parse(resultRaw) as RpcChatTurnResult,
	});
}

main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	writeLine({ type: "error", message });
	process.exit(1);
});
