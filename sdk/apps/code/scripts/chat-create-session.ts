import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { RpcSessionClient } from "@cline/rpc";
import type { RpcChatStartSessionRequest } from "@cline/shared";
import { setHomeDir, setHomeDirIfUnset } from "@cline/shared";

function readStdin(): string {
	return readFileSync(0, "utf8");
}

async function main() {
	const raw = readStdin();
	const config = JSON.parse(raw) as RpcChatStartSessionRequest;
	const homeDir = config.sessions?.homeDir?.trim();
	if (homeDir) {
		setHomeDir(homeDir);
	} else {
		setHomeDirIfUnset(homedir());
	}
	const address = process.env.CLINE_RPC_ADDRESS?.trim() || "127.0.0.1:4317";
	const client = new RpcSessionClient({ address });
	try {
		const response = await client.startRuntimeSession(JSON.stringify(config));
		if (!response.sessionId?.trim()) {
			throw new Error("runtime start returned an empty session id");
		}
		process.stdout.write(
			`${JSON.stringify({ sessionId: response.sessionId })}\n`,
		);
	} finally {
		client.close();
	}
}

main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(message);
	process.exit(1);
});
