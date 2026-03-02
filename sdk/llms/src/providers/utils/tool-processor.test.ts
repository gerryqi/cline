import { describe, expect, it } from "vitest";
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
});
