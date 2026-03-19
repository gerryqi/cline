import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { sessionLogPath } from "../paths";
import { nowMs, sendEvent } from "../state";
import type { HostContext } from "../types";

export function appendSessionChunk(
	sessionId: string,
	stream: string,
	chunk: string,
	ts: number,
) {
	const path = sessionLogPath(sessionId);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify({ ts, stream, chunk })}\n`, {
		flag: "a",
	});
}

export function emitChunk(
	ctx: HostContext,
	sessionId: string,
	stream: string,
	chunk: string,
) {
	const ts = nowMs();
	appendSessionChunk(sessionId, stream, chunk, ts);
	sendEvent(ctx, "chat_event", {
		sessionId,
		stream,
		chunk,
		ts,
	});
}
