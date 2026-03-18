import { describe, expect, it } from "vitest";
import type { Message } from "../types/messages";
import type { ApiStreamChunk } from "../types/stream";
import { OpenAIResponsesHandler } from "./openai-responses";

class TestOpenAIResponsesHandler extends OpenAIResponsesHandler {
	private readonly functionCallMetadataByItemId = new Map<
		string,
		{ callId?: string; name?: string }
	>();

	processChunkForTest(chunk: any, responseId = "resp_1"): ApiStreamChunk[] {
		return [
			...this.processResponseChunk(
				chunk,
				{ id: "gpt-5.4", capabilities: ["tools"] },
				responseId,
				this.functionCallMetadataByItemId,
			),
		];
	}
}

describe("OpenAIResponsesHandler", () => {
	it("converts tool_use/tool_result message history into Responses input items", () => {
		const handler = new TestOpenAIResponsesHandler({
			providerId: "openai-native",
			modelId: "gpt-5.4",
			apiKey: "test-key",
			baseUrl: "https://example.com",
		});

		const messages: Message[] = [
			{ role: "user", content: [{ type: "text", text: "Run pwd" }] },
			{
				role: "assistant",
				content: [
					{ type: "text", text: "Running command..." },
					{
						type: "tool_use",
						id: "fc_1",
						call_id: "call_1",
						name: "run_commands",
						input: { commands: ["pwd"] },
					},
					{ type: "text", text: "Waiting for output" },
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "call_1",
						content: "/tmp/workspace",
					},
					{ type: "text", text: "continue" },
				],
			},
		];

		const input = handler.getMessages("system", messages);

		expect(input).toEqual([
			{
				type: "message",
				role: "user",
				content: [{ type: "input_text", text: "Run pwd" }],
			},
			{
				type: "message",
				role: "assistant",
				content: [{ type: "output_text", text: "Running command..." }],
			},
			{
				type: "function_call",
				call_id: "call_1",
				name: "run_commands",
				arguments: '{"commands":["pwd"]}',
			},
			{
				type: "message",
				role: "assistant",
				content: [{ type: "output_text", text: "Waiting for output" }],
			},
			{
				type: "function_call_output",
				call_id: "call_1",
				output: "/tmp/workspace",
			},
			{
				type: "message",
				role: "user",
				content: [{ type: "input_text", text: "continue" }],
			},
		]);
	});

	it("falls back to tool_use id when call_id is unavailable", () => {
		const handler = new TestOpenAIResponsesHandler({
			providerId: "openai-native",
			modelId: "gpt-5.4",
			apiKey: "test-key",
			baseUrl: "https://example.com",
		});

		const messages: Message[] = [
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "fc_123",
						name: "search_codebase",
						input: { pattern: "history" },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "fc_123",
						content: "found",
					},
				],
			},
		];

		const input = handler.getMessages("system", messages);
		expect(input).toEqual([
			{
				type: "function_call",
				call_id: "fc_123",
				name: "search_codebase",
				arguments: '{"pattern":"history"}',
			},
			{
				type: "function_call_output",
				call_id: "fc_123",
				output: "found",
			},
		]);
	});

	it("does not map function-call item ids to tool names", () => {
		const handler = new TestOpenAIResponsesHandler({
			providerId: "openai-native",
			modelId: "gpt-5.4",
			apiKey: "test-key",
			baseUrl: "https://example.com",
		});

		const itemId = "fc_03aad4ff6c019bed0069ba5e9ad030819f8b2b06c5ac013811";

		const addedChunks = handler.processChunkForTest({
			type: "response.output_item.added",
			item: {
				type: "function_call",
				id: itemId,
				call_id: "call_1",
				name: "run_commands",
				arguments: "{}",
			},
		});
		const deltaChunks = handler.processChunkForTest({
			type: "response.function_call_arguments.delta",
			item_id: itemId,
			delta: '{"commands":["pwd"]',
		});

		expect(addedChunks).toHaveLength(1);
		expect(deltaChunks).toHaveLength(1);
		expect(deltaChunks[0]).toMatchObject({
			type: "tool_calls",
			tool_call: {
				call_id: "call_1",
				function: {
					id: itemId,
					name: "run_commands",
				},
			},
		});
	});

	it("leaves tool name undefined for argument deltas without metadata", () => {
		const handler = new TestOpenAIResponsesHandler({
			providerId: "openai-native",
			modelId: "gpt-5.4",
			apiKey: "test-key",
			baseUrl: "https://example.com",
		});

		const itemId = "fc_unknown";
		const deltaChunks = handler.processChunkForTest({
			type: "response.function_call_arguments.delta",
			item_id: itemId,
			delta: '{"x":1}',
		});

		expect(deltaChunks).toHaveLength(1);
		expect(deltaChunks[0]).toMatchObject({
			type: "tool_calls",
			tool_call: {
				function: {
					id: itemId,
					name: undefined,
				},
			},
		});
	});
});
