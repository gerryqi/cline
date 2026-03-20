import { describe, expect, it } from "vitest";
import { getOpenAIToolParams } from "../transform/openai-format";
import { ToolCallProcessor } from "./tool-processor";

describe("ToolCallProcessor", () => {
	it("emits delta arguments (not cumulative) so downstream can accumulate once", () => {
		const processor = new ToolCallProcessor();

		const first = processor.processToolCallDeltas(
			[
				{
					index: 0,
					id: "call_1",
					function: { name: "run_commands", arguments: '{"commands":["ls' },
				},
			],
			"resp_1",
		);

		const second = processor.processToolCallDeltas(
			[
				{
					index: 0,
					function: { arguments: ' -la"]}' },
				},
			],
			"resp_1",
		);

		expect(first).toHaveLength(1);
		expect(second).toHaveLength(1);
		expect(first[0].tool_call.function.arguments).toBe('{"commands":["ls');
		expect(second[0].tool_call.function.arguments).toBe(' -la"]}');
	});

	it("normalizes cumulative argument snapshots into deltas", () => {
		const processor = new ToolCallProcessor();

		const first = processor.processToolCallDeltas(
			[
				{
					index: 0,
					id: "call_1",
					function: { name: "editor", arguments: '{"command":"create"' },
				},
			],
			"resp_1",
		);

		const second = processor.processToolCallDeltas(
			[
				{
					index: 0,
					function: {
						arguments: '{"command":"create","path":"/tmp/file.txt"}',
					},
				},
			],
			"resp_1",
		);

		expect(first).toHaveLength(1);
		expect(second).toHaveLength(1);
		expect(first[0].tool_call.function.arguments).toBe('{"command":"create"');
		expect(second[0].tool_call.function.arguments).toBe(
			',"path":"/tmp/file.txt"}',
		);
	});

	it("serializes object-shaped arguments instead of concatenating [object Object]", () => {
		const processor = new ToolCallProcessor();

		const result = processor.processToolCallDeltas(
			[
				{
					index: 0,
					id: "call_1",
					function: {
						name: "editor",
						arguments: {
							command: "create",
							path: "/tmp/file.txt",
						},
					},
				},
			],
			"resp_1",
		);

		expect(result).toHaveLength(1);
		expect(result[0].tool_call.function.arguments).toBe(
			'{"command":"create","path":"/tmp/file.txt"}',
		);
	});

	it("preserves tool call id/name for interleaved parallel deltas", () => {
		const processor = new ToolCallProcessor();

		const firstChunk = [
			{
				index: 0,
				id: "call_a",
				function: { name: "read_file" },
			},
			{
				index: 1,
				id: "call_b",
				function: { name: "search_files" },
			},
		];

		const secondChunk = [
			{
				index: 1,
				function: { arguments: '{"path":"src"}' },
			},
			{
				index: 0,
				function: { arguments: '{"path":"README.md"}' },
			},
		];

		const firstResult = processor.processToolCallDeltas(firstChunk, "resp_1");
		const secondResult = processor.processToolCallDeltas(secondChunk, "resp_1");

		// Current implementation emits tool call chunks once id+name are known,
		// even before argument deltas arrive.
		expect(firstResult).toHaveLength(2);
		expect(secondResult).toHaveLength(2);

		// Intentionally reversed from the setup chunk: output follows incoming
		// argument-delta order while reconstruction remains index-safe.
		const firstToolCall = secondResult[0].tool_call;
		const secondToolCall = secondResult[1].tool_call;

		expect(firstToolCall.function.id).toBe("call_b");
		expect(firstToolCall.function.name).toBe("search_files");
		expect(firstToolCall.function.arguments).toBe('{"path":"src"}');

		expect(secondToolCall.function.id).toBe("call_a");
		expect(secondToolCall.function.name).toBe("read_file");
		expect(secondToolCall.function.arguments).toBe('{"path":"README.md"}');
	});

	it("clears accumulated state on reset", () => {
		const processor = new ToolCallProcessor();

		const setupChunk = [
			{
				index: 0,
				id: "call_reset",
				function: { name: "read_file" },
			},
		];

		const argsChunk = [
			{
				index: 0,
				function: { arguments: '{"path":"after-reset"}' },
			},
		];

		expect(processor.processToolCallDeltas(setupChunk, "resp_1")).toHaveLength(
			1,
		);
		processor.reset();
		expect(processor.processToolCallDeltas(argsChunk, "resp_1")).toHaveLength(
			0,
		);

		const newSetupChunk = [
			{
				index: 0,
				id: "call_new",
				function: { name: "write_file" },
			},
		];

		const newArgsChunk = [
			{
				index: 0,
				function: { arguments: '{"path":"file.txt"}' },
			},
		];

		expect(
			processor.processToolCallDeltas(newSetupChunk, "resp_1"),
		).toHaveLength(1);
		expect(
			processor.processToolCallDeltas(newArgsChunk, "resp_1"),
		).toHaveLength(1);
	});
});

describe("getOpenAIToolParams", () => {
	it("returns tools and tool_choice when tools are present", () => {
		const tools = [
			{
				name: "read_file",
				description: "",
				inputSchema: { type: "object" },
			},
		];

		const params = getOpenAIToolParams(tools);

		expect(params.tools).toHaveLength(1);
		expect(params.tool_choice).toBe("auto");
		expect(params).not.toHaveProperty("parallel_tool_calls");
	});

	it("returns empty object when tools are absent", () => {
		const params = getOpenAIToolParams(undefined);

		expect(params).toEqual({});
		expect(params).not.toHaveProperty("parallel_tool_calls");
	});

	it("supports strict option passthrough", () => {
		const tools = [
			{
				name: "read_file",
				description: "",
				inputSchema: { type: "object" },
			},
		];

		const params = getOpenAIToolParams(tools, { strict: false });

		expect(params.tools?.[0]).toMatchObject({
			type: "function",
			function: { strict: false },
		});
	});
});
