import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import type { ProtoGrpcType } from "./proto-types.js";

export const DEFAULT_RPC_ADDRESS = "127.0.0.1:4317";
export const PACKAGE_NAME = "cline.rpc.v1";
export const SERVICE_NAME = "ClineGateway";

export function parseAddress(address: string): { host: string; port: number } {
	const trimmed = address.trim();
	const idx = trimmed.lastIndexOf(":");
	if (idx <= 0 || idx >= trimmed.length - 1) {
		throw new Error(`Invalid RPC address: ${address}`);
	}
	const host = trimmed.slice(0, idx);
	const port = Number.parseInt(trimmed.slice(idx + 1), 10);
	if (!Number.isInteger(port) || port <= 0) {
		throw new Error(`Invalid RPC port in address: ${address}`);
	}
	return { host, port };
}

function resolveProtoPath(): string {
	const runtimeDir = dirname(fileURLToPath(import.meta.url));
	const candidates = [
		join(runtimeDir, "..", "proto", "rpc.proto"),
		join(runtimeDir, "..", "..", "src", "proto", "rpc.proto"),
		join(process.cwd(), "packages", "rpc", "src", "proto", "rpc.proto"),
	];
	for (const candidate of candidates) {
		if (existsSync(candidate)) {
			return candidate;
		}
	}
	throw new Error("Unable to resolve rpc.proto path");
}

export function loadGatewayService(): grpc.ServiceDefinition {
	const packageDef = protoLoader.loadSync(resolveProtoPath(), {
		keepCase: false,
		longs: String,
		enums: String,
		defaults: true,
		oneofs: true,
	});
	const loaded = grpc.loadPackageDefinition(
		packageDef,
	) as unknown as ProtoGrpcType;
	const service = loaded.cline?.rpc?.v1?.ClineGateway?.service;
	if (!service) {
		throw new Error(
			`Unable to load ${PACKAGE_NAME}.${SERVICE_NAME} from proto`,
		);
	}
	return service;
}
