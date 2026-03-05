import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { RpcSessionClient } from "@cline/rpc";
import type { RpcChatRunTurnRequest, RpcChatTurnResult } from "@cline/shared";
import { setHomeDir, setHomeDirIfUnset } from "@cline/shared";

type ChatStreamLine =
	| {
			type: "chunk";
			stream: "chat_text";
			chunk: string;
	  }
	| {
			type: "result";
			result: RpcChatTurnResult;
	  };

function readStdin(): string {
	return readFileSync(0, "utf8");
}

function writeStreamLine(line: ChatStreamLine): void {
	process.stdout.write(`${JSON.stringify(line)}\n`);
}

async function main() {
	const raw = readStdin();
	const request = JSON.parse(raw) as RpcChatRunTurnRequest;
	const sessionId = process.env.CLINE_SESSION_ID?.trim();
	if (!sessionId) {
		throw new Error("CLINE_SESSION_ID is required");
	}

	const homeDir = request.config.sessions?.homeDir?.trim();
	if (homeDir) {
		setHomeDir(homeDir);
	} else {
		setHomeDirIfUnset(homedir());
	}

	const address = process.env.CLINE_RPC_ADDRESS?.trim() || "127.0.0.1:4317";
	const client = new RpcSessionClient({ address });
	try {
		const response = await client.sendRuntimeSession(
			sessionId,
			JSON.stringify(request),
		);
		const resultRaw = response.resultJson?.trim();
		if (!resultRaw) {
			throw new Error("runtime send returned an empty result payload");
		}
		const result = JSON.parse(resultRaw) as RpcChatTurnResult;
		if (result.text) {
			writeStreamLine({
				type: "chunk",
				stream: "chat_text",
				chunk: result.text,
			});
		}
		writeStreamLine({
			type: "result",
			result,
		});
	} finally {
		client.close();
	}
}

main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(message);
	process.exit(1);
});
