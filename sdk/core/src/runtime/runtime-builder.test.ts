import type { Tool } from "@cline/agents";
import { describe, expect, it } from "vitest";
import { DefaultRuntimeBuilder } from "./runtime-builder";

function makeSpawnTool(): Tool {
	return {
		name: "spawn_agent",
		description: "Spawn a subagent",
		inputSchema: { type: "object", properties: {}, required: [] },
		execute: async () => ({ ok: true }),
	};
}

describe("DefaultRuntimeBuilder", () => {
	it("includes builtin tools when enabled", () => {
		const runtime = new DefaultRuntimeBuilder().build({
			config: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-6",
				apiKey: "key",
				systemPrompt: "test",
				cwd: process.cwd(),
				enableTools: true,
				enableSpawnAgent: false,
				enableAgentTeams: false,
			},
		});

		const names = runtime.tools.map((tool) => tool.name);
		expect(names.length).toBeGreaterThan(0);
		expect(names).not.toContain("spawn_agent");
	});

	it("omits builtin tools when disabled", () => {
		const runtime = new DefaultRuntimeBuilder().build({
			config: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-6",
				apiKey: "key",
				systemPrompt: "test",
				cwd: process.cwd(),
				enableTools: false,
				enableSpawnAgent: false,
				enableAgentTeams: false,
			},
		});

		expect(runtime.tools).toEqual([]);
	});

	it("adds spawn tool when enabled", () => {
		const runtime = new DefaultRuntimeBuilder().build({
			config: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-6",
				apiKey: "key",
				systemPrompt: "test",
				cwd: process.cwd(),
				enableTools: false,
				enableSpawnAgent: true,
				enableAgentTeams: false,
			},
			createSpawnTool: makeSpawnTool,
		});

		expect(runtime.tools.map((tool) => tool.name)).toContain("spawn_agent");
	});

	it("provides a shutdown helper", () => {
		const runtime = new DefaultRuntimeBuilder().build({
			config: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-6",
				apiKey: "key",
				systemPrompt: "test",
				cwd: process.cwd(),
				enableTools: false,
				enableSpawnAgent: false,
				enableAgentTeams: false,
			},
		});

		expect(() => runtime.shutdown("test")).not.toThrow();
	});
});
