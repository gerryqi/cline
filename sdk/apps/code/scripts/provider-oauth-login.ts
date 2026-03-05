import { readFileSync } from "node:fs";
import { RpcSessionClient } from "@cline/rpc";
import type { RpcProviderOAuthLoginResponse } from "@cline/shared";

type RequestBody = {
	provider: string;
};

function readStdin(): string {
	return readFileSync(0, "utf8");
}

async function main() {
	const parsed = JSON.parse(readStdin()) as RequestBody;
	const provider = parsed.provider?.trim();
	if (!provider) {
		throw new Error("provider is required");
	}

	const address = process.env.CLINE_RPC_ADDRESS?.trim() || "127.0.0.1:4317";
	const client = new RpcSessionClient({ address });
	try {
		const response = (await client.runProviderOAuthLogin(
			provider,
		)) as RpcProviderOAuthLoginResponse;
		process.stdout.write(
			`${JSON.stringify({ provider: response.provider, apiKey: response.apiKey })}\n`,
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
