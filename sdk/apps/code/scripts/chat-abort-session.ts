import { readFileSync } from "node:fs";
import { RpcSessionClient } from "@cline/rpc";

type AbortSessionRequest = {
	sessionId: string;
};

function readStdin(): string {
	return readFileSync(0, "utf8");
}

async function main() {
	const raw = readStdin();
	const parsed = JSON.parse(raw) as AbortSessionRequest;
	const sessionId = parsed.sessionId?.trim();
	if (!sessionId) {
		throw new Error("sessionId is required");
	}
	const address = process.env.CLINE_RPC_ADDRESS?.trim() || "127.0.0.1:4317";
	const client = new RpcSessionClient({ address });
	try {
		const response = await client.abortRuntimeSession(sessionId);
		process.stdout.write(`${JSON.stringify({ applied: response.applied })}\n`);
	} finally {
		client.close();
	}
}

main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(message);
	process.exit(1);
});
