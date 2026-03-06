import { describe, expect, it } from "vitest";
import { MessageBuilder } from "./message-builder.js";

describe("MessageBuilder", () => {
	it("keeps cached indexes consistent across append and reset flows", () => {
		const builder = new MessageBuilder();
		const firstReadUse = {
			role: "assistant" as const,
			content: [
				{
					type: "tool_use" as const,
					id: "call_1",
					name: "read_file",
					input: { path: "src/app.ts" },
				},
			],
		};
		const firstReadResult = {
			role: "user" as const,
			content: [
				{
					type: "tool_result" as const,
					tool_use_id: "call_1",
					content: '[{"path":"src/app.ts","content":"export const v = 1;"}]',
					is_error: false,
				},
			],
		};
		const secondReadUse = {
			role: "assistant" as const,
			content: [
				{
					type: "tool_use" as const,
					id: "call_2",
					name: "read_file",
					input: { path: "src/app.ts" },
				},
			],
		};
		const secondReadResult = {
			role: "user" as const,
			content: [
				{
					type: "tool_result" as const,
					tool_use_id: "call_2",
					content: '[{"path":"src/app.ts","content":"export const v = 2;"}]',
					is_error: false,
				},
			],
		};

		const initial = builder.buildForApi([firstReadUse, firstReadResult]);
		expect(initial[1]?.content).toEqual(firstReadResult.content);

		const appended = builder.buildForApi([
			firstReadUse,
			firstReadResult,
			secondReadUse,
			secondReadResult,
		]);
		const firstContent = (
			appended[1] as { content: Array<{ content: string }> }
		).content[0]?.content;
		expect(firstContent).toContain("[outdated - see the latest file content]");

		const reset = builder.buildForApi([secondReadUse, secondReadResult]);
		expect(reset[1]?.content).toEqual(secondReadResult.content);
	});
});
