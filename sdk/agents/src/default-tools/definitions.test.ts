import { describe, expect, it, vi } from "vitest";
import { createDefaultTools } from "./definitions.js";

describe("default skills tool", () => {
	it("is included only when enabled with a skills executor", () => {
		const toolsWithoutExecutor = createDefaultTools({
			executors: {},
			enableSkills: true,
		});
		expect(toolsWithoutExecutor.map((tool) => tool.name)).not.toContain(
			"skills",
		);

		const toolsWithExecutor = createDefaultTools({
			executors: {
				skills: async () => "ok",
			},
			enableSkills: true,
		});
		expect(toolsWithExecutor.map((tool) => tool.name)).toContain("skills");
	});

	it("validates and executes skill invocation input", async () => {
		const execute = vi.fn(async () => "loaded");
		const tools = createDefaultTools({
			executors: {
				skills: execute,
			},
			enableReadFiles: false,
			enableSearch: false,
			enableBash: false,
			enableWebFetch: false,
			enableEditor: false,
			enableSkills: true,
		});
		const skillsTool = tools.find((tool) => tool.name === "skills");
		expect(skillsTool).toBeDefined();
		if (!skillsTool) {
			throw new Error("Expected skills tool to be defined.");
		}

		const result = await skillsTool.execute(
			{ skill: "commit", args: "-m 'fix'" },
			{
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
			},
		);

		expect(result).toBe("loaded");
		expect(execute).toHaveBeenCalledWith(
			"commit",
			"-m 'fix'",
			expect.objectContaining({
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
			}),
		);
	});
});
