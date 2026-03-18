import { describe, expect, it } from "vitest";
import type { CliLoggerAdapter } from "../logging/adapter";
import { createConnectorRuntimeTurnStream } from "./runtime-turn";

type StreamHandlers = {
	onEvent: (event: {
		eventType: string;
		payload: Record<string, unknown>;
	}) => void;
	onError: (error: Error) => void;
};

describe("createConnectorRuntimeTurnStream", () => {
	it("keeps tool status blocks in the same streamed message before later text", async () => {
		let handlers: StreamHandlers | undefined;

		const client = {
			streamEvents: (_request: unknown, callbacks: StreamHandlers) => {
				handlers = callbacks;
				return () => {};
			},
			sendRuntimeSession: async () => {
				handlers?.onEvent({
					eventType: "runtime.chat.tool_call_start",
					payload: {
						toolName: "read_file",
						input: { path: "/tmp/demo.txt" },
					},
				});
				handlers?.onEvent({
					eventType: "runtime.chat.text_delta",
					payload: { text: "Here is the result." },
				});
				return {
					result: {
						text: "Here is the result.",
						finishReason: "stop",
						iterations: 1,
					},
				};
			},
		};

		const chunks: string[] = [];
		for await (const chunk of createConnectorRuntimeTurnStream({
			client: client as never,
			sessionId: "session-1",
			request: { config: {} as never, prompt: "hi" },
			clientId: "client-1",
			logger: { core: {} } as unknown as CliLoggerAdapter,
			transport: "telegram",
			conversationId: "thread-1",
		})) {
			chunks.push(chunk);
		}

		expect(chunks.join("")).toContain("Executing read_file...");
		expect(chunks.join("")).toContain("Here is the result.");
		expect(chunks.join("")).toMatch(
			/Executing read_file\.\.\.[\s\S]*Here is the result\./,
		);
	});
});
