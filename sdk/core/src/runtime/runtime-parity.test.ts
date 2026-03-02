import { createBuiltinTools, type Tool } from "@cline/agents";
import { describe, expect, it } from "vitest";
import { DefaultRuntimeBuilder } from "./runtime-builder";

type LegacyConfig = {
	providerId: string;
	modelId: string;
	apiKey: string;
	systemPrompt: string;
	cwd: string;
	enableTools: boolean;
	enableSpawnAgent: boolean;
	enableAgentTeams: boolean;
};

function legacyBuiltinTools(cwd: string): Tool[] {
	return createBuiltinTools({
		cwd,
		enableReadFiles: true,
		enableSearch: true,
		enableBash: true,
		enableWebFetch: true,
	});
}

function legacyBuildRuntimeEnvironment(
	config: LegacyConfig,
	createSpawnTool?: () => Tool,
): Tool[] {
	const tools: Tool[] = [];
	if (config.enableTools) {
		tools.push(...legacyBuiltinTools(config.cwd));
	}
	if (config.enableSpawnAgent && createSpawnTool) {
		const spawnTool = createSpawnTool();
		tools.push({
			...spawnTool,
			execute: async (input, context) => spawnTool.execute(input, context),
		});
	}
	return tools;
}

function makeSpawnTool(): Tool {
	return {
		name: "spawn_agent",
		description: "Spawn a subagent",
		inputSchema: { type: "object", properties: {}, required: [] },
		execute: async () => ({ ok: true }),
	};
}

describe("runtime tool parity", () => {
	it("matches legacy tool list when tools+spawn are enabled", () => {
		const config: LegacyConfig = {
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			apiKey: "key",
			systemPrompt: "test",
			cwd: process.cwd(),
			enableTools: true,
			enableSpawnAgent: true,
			enableAgentTeams: false,
		};
		const createSpawnTool = makeSpawnTool;
		const expected = legacyBuildRuntimeEnvironment(config, createSpawnTool).map(
			(tool) => tool.name,
		);
		const actual = new DefaultRuntimeBuilder()
			.build({
				config,
				createSpawnTool,
			})
			.tools.map((tool) => tool.name);

		expect(actual).toEqual(expected);
	});

	it("matches legacy tool list when only spawn is enabled", () => {
		const config: LegacyConfig = {
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			apiKey: "key",
			systemPrompt: "test",
			cwd: process.cwd(),
			enableTools: false,
			enableSpawnAgent: true,
			enableAgentTeams: false,
		};
		const createSpawnTool = makeSpawnTool;
		const expected = legacyBuildRuntimeEnvironment(config, createSpawnTool).map(
			(tool) => tool.name,
		);
		const actual = new DefaultRuntimeBuilder()
			.build({
				config,
				createSpawnTool,
			})
			.tools.map((tool) => tool.name);

		expect(actual).toEqual(expected);
	});

	it("matches legacy tool list when tools+spawn are disabled", () => {
		const config: LegacyConfig = {
			providerId: "anthropic",
			modelId: "claude-sonnet-4-6",
			apiKey: "key",
			systemPrompt: "test",
			cwd: process.cwd(),
			enableTools: false,
			enableSpawnAgent: false,
			enableAgentTeams: false,
		};
		const expected = legacyBuildRuntimeEnvironment(config).map(
			(tool) => tool.name,
		);
		const actual = new DefaultRuntimeBuilder()
			.build({ config })
			.tools.map((tool) => tool.name);

		expect(actual).toEqual(expected);
	});
});
