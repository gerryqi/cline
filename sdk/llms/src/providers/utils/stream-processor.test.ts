import { describe, expect, it } from "vitest";
import { StreamResponseProcessor } from "./stream-processor";

describe("StreamResponseProcessor", () => {
	it("assembles text, reasoning, tool calls, usage, and completion metadata", () => {
		const processor = new StreamResponseProcessor();

		processor.process({
			type: "reasoning",
			id: "resp_1",
			reasoning: "thinking...",
			details: {
				type: "reasoning.text",
				text: "step 1",
				signature: "sig-r",
				format: "anthropic-claude-v1",
				index: 0,
			},
			redacted_data: "encrypted",
		});
		processor.process({
			type: "text",
			id: "resp_1",
			text: "Hello ",
		});
		processor.process({
			type: "text",
			id: "resp_1",
			text: "world",
			signature: "sig-text",
		});
		processor.process({
			type: "tool_calls",
			id: "resp_1",
			signature: "sig-tool",
			tool_call: {
				call_id: "call_1",
				function: {
					id: "tool_1",
					name: "read_file",
					arguments: '{"path":"/tmp/a',
				},
			},
		});
		processor.process({
			type: "tool_calls",
			id: "resp_1",
			tool_call: {
				function: {
					id: "tool_1",
					arguments: '.ts"}',
				},
			},
		});
		processor.process({
			type: "usage",
			id: "resp_1",
			inputTokens: 10,
			outputTokens: 20,
			cacheReadTokens: 5,
			cacheWriteTokens: 0,
			thoughtsTokenCount: 3,
			totalCost: 0.001,
		});
		const partial = processor.process({
			type: "done",
			id: "resp_1",
			success: true,
			incompleteReason: "max_output_tokens",
		});

		expect(partial.responseId).toBe("resp_1");
		expect(partial.content[0]).toMatchObject({
			type: "thinking",
			thinking: "thinking...",
			signature: "sig-r",
		});
		expect(partial.content[1]).toMatchObject({
			type: "text",
			text: "Hello world",
			signature: "sig-text",
		});
		expect(partial.content[2]).toMatchObject({
			type: "tool_use",
			id: "tool_1",
			name: "read_file",
			input: { path: "/tmp/a.ts" },
			signature: "sig-tool",
		});

		const final = processor.finalize();
		expect(final.responseId).toBe("resp_1");
		expect(final.incompleteReason).toBe("max_output_tokens");
		expect(final.usage).toEqual({
			inputTokens: 10,
			outputTokens: 20,
			cacheReadTokens: 5,
			cacheWriteTokens: 0,
			thoughtsTokenCount: 3,
			totalCost: 0.001,
		});
		expect(final.content[0]).toMatchObject({
			type: "thinking",
			thinking: "thinking...",
			summary: [
				{
					type: "reasoning.text",
					text: "step 1",
					signature: "sig-r",
					format: "anthropic-claude-v1",
					index: 0,
				},
			],
		});
		expect(final.content[1]).toEqual({
			type: "redacted_thinking",
			data: "encrypted",
			call_id: "resp_1",
		});
		expect(final.content[2]).toMatchObject({
			type: "text",
			text: "Hello world",
			signature: "sig-text",
			reasoning_details: [
				{
					type: "reasoning.text",
					text: "step 1",
					signature: "sig-r",
					format: "anthropic-claude-v1",
					index: 0,
				},
			],
		});
		expect(final.content[3]).toMatchObject({
			type: "tool_use",
			id: "tool_1",
			name: "read_file",
			input: { path: "/tmp/a.ts" },
			signature: "sig-tool",
		});
	});

	it("extracts partial JSON fields while arguments are incomplete", () => {
		const processor = new StreamResponseProcessor();

		const partial = processor.process({
			type: "tool_calls",
			id: "resp_2",
			tool_call: {
				call_id: "call_partial",
				function: {
					id: "tool_partial",
					name: "run_command",
					arguments:
						'{"command":"echo \\"hi\\"","cwd":"/Users/beatrix/dev/cline-packages',
				},
			},
		});

		expect(partial.content).toEqual([
			{
				type: "tool_use",
				id: "tool_partial",
				name: "run_command",
				input: {
					command: 'echo "hi"',
					cwd: "/Users/beatrix/dev/cline-packages",
				},
				call_id: "call_partial",
				signature: undefined,
			},
		]);
	});

	it("handles object arguments and reset()", () => {
		const processor = new StreamResponseProcessor();

		processor.process({
			type: "tool_calls",
			id: "resp_3",
			tool_call: {
				call_id: "call_obj",
				function: {
					id: "tool_obj",
					name: "edit_file",
					arguments: {
						path: "a.ts",
						content: "x",
					},
				},
			},
		});

		const finalBeforeReset = processor.finalize();
		expect(finalBeforeReset.content).toEqual([
			{
				type: "tool_use",
				id: "tool_obj",
				name: "edit_file",
				input: { path: "a.ts", content: "x" },
				call_id: "call_obj",
				signature: undefined,
				reasoning_details: undefined,
			},
		]);

		processor.reset();
		expect(processor.finalize()).toEqual({
			content: [],
			usage: undefined,
			responseId: undefined,
			incompleteReason: undefined,
		});
	});

	it("ignores tool call chunks that do not have an id", () => {
		const processor = new StreamResponseProcessor();

		processor.process({
			type: "tool_calls",
			id: "resp_4",
			tool_call: {
				function: {
					name: "ignored",
					arguments: "{}",
				},
			},
		});

		expect(processor.finalize().content).toEqual([]);
	});
});
