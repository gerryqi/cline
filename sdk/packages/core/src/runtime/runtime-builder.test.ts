import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Tool } from "@clinebot/agents";
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

	it("forwards runtime logger for downstream agent creation", () => {
		const logger = {
			info: () => {},
		};
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
				logger,
			},
		});

		expect(runtime.logger).toBe(logger);
	});

	it("uses readonly preset in plan mode", () => {
		const runtime = new DefaultRuntimeBuilder().build({
			config: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-6",
				apiKey: "key",
				systemPrompt: "test",
				cwd: process.cwd(),
				mode: "plan",
				enableTools: true,
				enableSpawnAgent: false,
				enableAgentTeams: false,
			},
		});

		const names = runtime.tools.map((tool) => tool.name);
		expect(names).not.toContain("editor");
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

	it("includes skills tool when workspace skills are available", () => {
		const cwd = mkdtempSync(join(tmpdir(), "runtime-builder-skills-"));
		const skillDir = join(cwd, ".cline", "skills", "commit");
		mkdirSync(skillDir, { recursive: true });
		writeFileSync(
			join(skillDir, "SKILL.md"),
			`---
name: commit
description: Create commit message
---
Use conventional commits.`,
			"utf8",
		);

		const runtime = new DefaultRuntimeBuilder().build({
			config: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-6",
				apiKey: "key",
				systemPrompt: "test",
				cwd,
				enableTools: true,
				enableSpawnAgent: false,
				enableAgentTeams: false,
			},
		});

		expect(runtime.tools.map((tool) => tool.name)).toContain("skills");
		runtime.shutdown("test");
	});

	it("marks configured but disabled skills in executor metadata", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "runtime-builder-skills-disabled-"));
		const enabledDir = join(cwd, ".cline", "skills", "commit");
		const disabledDir = join(cwd, ".cline", "skills", "review");
		mkdirSync(enabledDir, { recursive: true });
		mkdirSync(disabledDir, { recursive: true });
		writeFileSync(
			join(enabledDir, "SKILL.md"),
			`---
name: commit
---
Enabled skill.`,
			"utf8",
		);
		writeFileSync(
			join(disabledDir, "SKILL.md"),
			`---
name: review
disabled: true
---
Disabled skill.`,
			"utf8",
		);

		const runtime = new DefaultRuntimeBuilder().build({
			config: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-6",
				apiKey: "key",
				systemPrompt: "test",
				cwd,
				enableTools: true,
				enableSpawnAgent: false,
				enableAgentTeams: false,
			},
		});

		const skillsTool = runtime.tools.find((tool) => tool.name === "skills");
		expect(skillsTool).toBeDefined();
		if (!skillsTool) {
			throw new Error("Expected skills tool.");
		}

		const disabledResult = await skillsTool.execute(
			{ skill: "review" },
			{
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
			},
		);
		expect(disabledResult).toContain("configured but disabled");

		runtime.shutdown("test");
	});
});
