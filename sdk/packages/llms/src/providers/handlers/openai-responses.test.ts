import { describe, expect, it } from "vitest";
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
