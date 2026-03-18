import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function resolveRpcProtoPath(importMetaUrl: string): string {
	const runtimeDir = dirname(fileURLToPath(importMetaUrl));
	const candidates = new Set<string>([
		join(runtimeDir, "proto", "rpc.proto"),
		join(runtimeDir, "..", "proto", "rpc.proto"),
		join(runtimeDir, "..", "src", "proto", "rpc.proto"),
		join(runtimeDir, "..", "..", "src", "proto", "rpc.proto"),
		join(process.cwd(), "src", "proto", "rpc.proto"),
		join(process.cwd(), "packages", "rpc", "src", "proto", "rpc.proto"),
	]);

	let cursor = process.cwd();
	while (true) {
		candidates.add(
			join(cursor, "packages", "rpc", "src", "proto", "rpc.proto"),
		);
		const parent = dirname(cursor);
		if (parent === cursor) {
			break;
		}
		cursor = parent;
	}

	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	throw new Error("Unable to resolve rpc.proto path");
}
