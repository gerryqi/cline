import { jsonrepair } from "jsonrepair";

function tryParseJson(text: string): unknown {
	return JSON.parse(text);
}

export function parseJsonStream(input: unknown): unknown {
	if (typeof input !== "string") return input;

	const text = input.trimStart();
	if (!(text.startsWith("{") || text.startsWith("["))) return input;

	try {
		return tryParseJson(text);
	} catch {
		try {
			return tryParseJson(jsonrepair(text));
		} catch {
			return input;
		}
	}
}

export function safeJsonStringify(input: unknown): string {
	const seen = new WeakSet<object>();

	try {
		const result = JSON.stringify(input, (_key, value) => {
			if (typeof value === "bigint") return value.toString();

			if (value && typeof value === "object") {
				if (seen.has(value as object)) return "[Circular]";
				seen.add(value as object);
			}

			return value;
		});

		return result ?? "null";
	} catch {
		return String(input);
	}
}
