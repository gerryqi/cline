import type { AgentEvent } from "@clinebot/agents";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleEvent } from "./events";
import { setCurrentOutputMode } from "./output";
import type { Config } from "./types";

describe("handleEvent text formatting", () => {
	let output = "";

	beforeEach(() => {
		output = "";
		setCurrentOutputMode("text");
		vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
			output += String(chunk);
			return true;
		});
	});

	it("adds an empty line before text that follows a tool block", () => {
		handleEvent(
			{
				type: "content_start",
				contentType: "tool",
				toolName: "read_files",
				input: { path: "/tmp/demo.txt" },
			} as unknown as AgentEvent,
			{} as Config,
		);
		handleEvent(
			{
				type: "content_end",
				contentType: "tool",
				toolName: "read_files",
				output: "ok",
			} as unknown as AgentEvent,
			{} as Config,
		);
		handleEvent(
			{
				type: "content_start",
				contentType: "text",
				text: "Now let me check this file.",
			} as unknown as AgentEvent,
			{} as Config,
		);

		expect(output).toContain("-> ok");
		expect(output).toContain("\n\nNow let me check this file.");
	});
});
