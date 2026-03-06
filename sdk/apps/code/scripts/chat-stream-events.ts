import { createInterface } from "node:readline";
import { RpcSessionClient } from "@cline/rpc";

type BridgeControlLine =
	| {
			type: "set_sessions";
			sessionIds: string[];
	  }
	| {
			type: "shutdown";
	  };

type BridgeOutputLine =
	| {
			type: "ready";
	  }
	| {
			type: "chat_text";
			sessionId: string;
			chunk: string;
	  }
	| {
			type: "tool_call_start";
			sessionId: string;
			toolCallId?: string;
			toolName?: string;
			input?: unknown;
	  }
	| {
			type: "tool_call_end";
			sessionId: string;
			toolCallId?: string;
			toolName?: string;
			output?: unknown;
			error?: string;
			durationMs?: number;
	  }
	| {
			type: "error";
			message: string;
	  };

function writeLine(line: BridgeOutputLine): void {
	process.stdout.write(`${JSON.stringify(line)}\n`);
}

function parsePayload(payloadJson: string): Record<string, unknown> {
	if (!payloadJson.trim()) {
		return {};
	}
	try {
		return JSON.parse(payloadJson) as Record<string, unknown>;
	} catch {
		return {};
	}
}

function normalizeSessionIds(sessionIds: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const raw of sessionIds) {
		const value = raw.trim();
		if (!value || seen.has(value)) {
			continue;
		}
		seen.add(value);
		out.push(value);
	}
	return out;
}

function areSessionListsEqual(left: string[], right: string[]): boolean {
	if (left.length !== right.length) {
		return false;
	}
	for (let index = 0; index < left.length; index += 1) {
		if (left[index] !== right[index]) {
			return false;
		}
	}
	return true;
}

function resolveTextDelta(
	payload: Record<string, unknown>,
	previous: string,
): {
	delta: string;
	nextAccumulated: string;
} {
	const accumulated =
		typeof payload.accumulated === "string" ? payload.accumulated : undefined;
	if (typeof accumulated === "string") {
		if (accumulated.startsWith(previous)) {
			return {
				delta: accumulated.slice(previous.length),
				nextAccumulated: accumulated,
			};
		}
		if (previous.startsWith(accumulated)) {
			return {
				delta: "",
				nextAccumulated: previous,
			};
		}
	}
	const text = typeof payload.text === "string" ? payload.text : "";
	return {
		delta: text,
		nextAccumulated: `${previous}${text}`,
	};
}

async function main() {
	const address = process.env.CLINE_RPC_ADDRESS?.trim() || "127.0.0.1:4317";
	const clientId =
		process.env.CLINE_RPC_CLIENT_ID?.trim() ||
		`code-chat-stream-${process.pid}`;
	const client = new RpcSessionClient({ address });

	let stopStreaming: (() => void) | undefined;
	let activeSessionIds: string[] = [];
	const accumulatedBySession = new Map<string, string>();

	const restartStream = () => {
		stopStreaming?.();
		stopStreaming = undefined;
		if (activeSessionIds.length === 0) {
			return;
		}
		stopStreaming = client.streamEvents(
			{
				clientId,
				sessionIds: activeSessionIds,
			},
			{
				onEvent: (event) => {
					const payload = parsePayload(event.payloadJson);
					if (event.eventType === "runtime.chat.text_delta") {
						const prev = accumulatedBySession.get(event.sessionId) ?? "";
						const resolved = resolveTextDelta(payload, prev);
						accumulatedBySession.set(event.sessionId, resolved.nextAccumulated);
						if (!resolved.delta) {
							return;
						}
						writeLine({
							type: "chat_text",
							sessionId: event.sessionId,
							chunk: resolved.delta,
						});
						return;
					}
					if (event.eventType === "runtime.chat.tool_call_start") {
						writeLine({
							type: "tool_call_start",
							sessionId: event.sessionId,
							toolCallId:
								typeof payload.toolCallId === "string"
									? payload.toolCallId
									: undefined,
							toolName:
								typeof payload.toolName === "string"
									? payload.toolName
									: undefined,
							input: payload.input,
						});
						return;
					}
					if (event.eventType === "runtime.chat.tool_call_end") {
						writeLine({
							type: "tool_call_end",
							sessionId: event.sessionId,
							toolCallId:
								typeof payload.toolCallId === "string"
									? payload.toolCallId
									: undefined,
							toolName:
								typeof payload.toolName === "string"
									? payload.toolName
									: undefined,
							output: payload.output,
							error:
								typeof payload.error === "string" ? payload.error : undefined,
							durationMs:
								typeof payload.durationMs === "number"
									? payload.durationMs
									: undefined,
						});
					}
				},
				onError: (error) => {
					writeLine({
						type: "error",
						message: error.message,
					});
				},
			},
		);
	};

	const applySessions = (nextSessionIds: string[]) => {
		const normalized = normalizeSessionIds(nextSessionIds).sort();
		if (areSessionListsEqual(activeSessionIds, normalized)) {
			return;
		}
		activeSessionIds = normalized;
		for (const key of Array.from(accumulatedBySession.keys())) {
			if (!normalized.includes(key)) {
				accumulatedBySession.delete(key);
			}
		}
		restartStream();
	};

	writeLine({ type: "ready" });

	const rl = createInterface({
		input: process.stdin,
		output: process.stderr,
		terminal: false,
	});

	rl.on("line", (line) => {
		const trimmed = line.trim();
		if (!trimmed) {
			return;
		}
		let parsed: BridgeControlLine;
		try {
			parsed = JSON.parse(trimmed) as BridgeControlLine;
		} catch {
			writeLine({ type: "error", message: "invalid bridge control json" });
			return;
		}
		if (parsed.type === "set_sessions") {
			applySessions(parsed.sessionIds ?? []);
			return;
		}
		if (parsed.type === "shutdown") {
			stopStreaming?.();
			client.close();
			process.exit(0);
		}
	});

	rl.on("close", () => {
		stopStreaming?.();
		client.close();
		process.exit(0);
	});
}

main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	writeLine({ type: "error", message });
	process.exit(1);
});
