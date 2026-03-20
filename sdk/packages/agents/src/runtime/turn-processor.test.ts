import type { providers } from "@clinebot/llms";
import { describe, expect, it } from "vitest";
import { MessageBuilder } from "../message-builder.js";
import { TurnProcessor } from "./turn-processor.js";

async function* streamChunks(
	chunks: providers.ApiStreamChunk[],
): AsyncGenerator<providers.ApiStreamChunk> {
	for (const chunk of chunks) {
		yield chunk;
	}
}

function createProcessor(chunks: providers.ApiStreamChunk[]): TurnProcessor {
	const handler: providers.ApiHandler = {
		getMessages: () => [],
		createMessage: () => streamChunks(chunks),
		getModel: () => ({
			id: "mock-model",
			info: {
				id: "mock-model",
			},
		}),
	};

	return new TurnProcessor({
		handler,
		messageBuilder: new MessageBuilder(),
		emit: () => {},
	});
}

describe("TurnProcessor", () => {
	it("reconstructs tool arguments from streamed delta fragments", async () => {
		const processor = createProcessor([
			{
				type: "tool_calls",
				id: "r1",
				tool_call: {
					call_id: "call_1",
					function: {
						name: "str_replace",
						arguments: '{"command":"str_replace","path":"/some/file"',
					},
				},
			},
			{
				type: "tool_calls",
				id: "r1",
				tool_call: {
					call_id: "call_1",
					function: {
						arguments: ',"old_str":"before","new_str":"after"}',
					},
				},
			},
			{ type: "done", id: "r1", success: true },
		]);

		const { turn } = await processor.processTurn(
			[],
			"system",
			[],
			new AbortController().signal,
		);

		expect(turn.invalidToolCalls).toEqual([]);
		expect(turn.toolCalls).toHaveLength(1);
		expect(turn.toolCalls[0]).toMatchObject({
			id: "call_1",
			name: "str_replace",
			input: {
				command: "str_replace",
				path: "/some/file",
				old_str: "before",
				new_str: "after",
			},
		});
	});

	it("treats a truncated json fragment as a complete tool input", async () => {
		const processor = createProcessor([
			{
				type: "tool_calls",
				id: "r1",
				tool_call: {
					call_id: "call_1",
					function: {
						name: "str_replace",
						arguments: '{"command":"str_replace","path":"/some/file"',
					},
				},
			},
			{ type: "done", id: "r1", success: true },
		]);

		const { turn } = await processor.processTurn(
			[],
			"system",
			[],
			new AbortController().signal,
		);

		expect(turn.invalidToolCalls).toEqual([]);
		expect(turn.toolCalls).toHaveLength(1);
		expect(turn.toolCalls[0]).toMatchObject({
			id: "call_1",
			name: "str_replace",
			input: {
				command: "str_replace",
				path: "/some/file",
			},
		});
	});

	it("persists invalid tool calls with a synthetic tool_use block", async () => {
		const processor = createProcessor([
			{
				type: "tool_calls",
				id: "r1",
				tool_call: {
					call_id: "call_1",
					function: {
						name: "editor",
						arguments: '{"command":"create","path":/tmp/file.txt}',
					},
				},
			},
			{ type: "done", id: "r1", success: true },
		]);

		const { turn, assistantMessage } = await processor.processTurn(
			[],
			"system",
			[],
			new AbortController().signal,
		);

		expect(turn.toolCalls).toEqual([]);
		expect(turn.invalidToolCalls).toEqual([
			{
				id: "call_1",
				name: "editor",
				input: {
					raw_arguments: '{"command":"create","path":/tmp/file.txt}',
				},
				reason: "invalid_arguments",
			},
		]);
		expect(assistantMessage).toBeDefined();
		expect(assistantMessage?.content).toContainEqual({
			type: "tool_use",
			id: "call_1",
			name: "editor",
			input: {
				raw_arguments: '{"command":"create","path":/tmp/file.txt}',
			},
		});
	});
});
