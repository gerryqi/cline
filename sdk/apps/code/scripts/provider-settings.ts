import { readFileSync } from "node:fs";
import { RpcSessionClient } from "@clinebot/rpc";
import type { RpcProviderActionRequest } from "@clinebot/shared";

function readStdin(): string {
	return readFileSync(0, "utf8");
}

async function main() {
	const parsed = JSON.parse(readStdin()) as RpcProviderActionRequest;
	const address = process.env.CLINE_RPC_ADDRESS?.trim() || "127.0.0.1:4317";
	const client = new RpcSessionClient({ address });
	try {
		const response = await client.runProviderAction(parsed);
		process.stdout.write(`${JSON.stringify(response.result)}\n`);
	} finally {
		client.close();
	}
}

main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(message);
	process.exit(1);
});
