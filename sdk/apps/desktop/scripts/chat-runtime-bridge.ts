import {
	type RpcRuntimeBridgeCommandOutputLine,
	runRpcRuntimeCommandBridge,
} from "@clinebot/core";

function writeLine(line: RpcRuntimeBridgeCommandOutputLine): void {
	process.stdout.write(`${JSON.stringify(line)}\n`);
}

async function main() {
	const clientId =
		process.env.CLINE_RPC_CLIENT_ID?.trim() ||
		`desktop-chat-runtime-bridge-${process.pid}`;
	await runRpcRuntimeCommandBridge({
		clientId,
		writeLine,
		parseSendResult: (resultRaw) => resultRaw,
	});
}

main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	writeLine({ type: "error", message });
	process.exit(1);
});
