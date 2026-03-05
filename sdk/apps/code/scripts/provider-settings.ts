import { readFileSync } from "node:fs";
import { RpcSessionClient } from "@cline/rpc";
import type { RpcProviderActionRequest } from "@cline/shared";

function readStdin(): string {
	return readFileSync(0, "utf8");
}

async function main() {
	const parsed = JSON.parse(readStdin()) as RpcProviderActionRequest;
	const address = process.env.CLINE_RPC_ADDRESS?.trim() || "127.0.0.1:4317";
	const client = new RpcSessionClient({ address });
	try {
		const response = await client.runProviderAction(JSON.stringify(parsed));
		const payload = response.resultJson?.trim();
		if (!payload) {
			throw new Error("provider action returned an empty response");
		}
		process.stdout.write(`${payload}\n`);
	} finally {
		client.close();
	}
}

main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(message);
	process.exit(1);
});
