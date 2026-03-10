/**
 * Custom Plugin Example
 *
 * Shows how to extend @cline/agents with your own plugins.
 * A plugin can register custom tools and hook into the agent lifecycle.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... bun run apps/examples/cline-plugin/index.ts
 */

import { Agent, type AgentConfig, createTool } from "@cline/agents";

// The AgentExtension type — all plugins share this shape.
// Use AgentConfig to derive it without a direct import.
type Plugin = NonNullable<AgentConfig["extensions"]>[number];

// =============================================================================
// Plugin 1: Custom Tool
// =============================================================================
// Register tools the agent can call. Tools are discovered and invoked
// automatically — just describe what they do and implement execute().

const weatherPlugin: Plugin = {
	name: "weather-plugin",
	manifest: {
		capabilities: ["tools"],
	},
	setup(api) {
		api.registerTool(
			createTool({
				name: "get_weather",
				description: "Get the current weather for a city",
				inputSchema: {
					type: "object",
					properties: {
						city: { type: "string", description: "The city name" },
					},
					required: ["city"],
				},
				execute: async (input: unknown) => {
					// Replace with a real weather API call in production.
					const { city } = input as { city: string };
					return {
						city,
						temperature: "72°F",
						condition: "sunny",
						humidity: "45%",
					};
				},
			}),
		);
	},
};

// =============================================================================
// Plugin 2: Lifecycle Hooks
// =============================================================================
// Hooks let you observe (and optionally influence) the agent at key points.
// Every stage you use must be listed in manifest.hookStages.

const metricsPlugin: Plugin = {
	name: "metrics-plugin",
	manifest: {
		capabilities: ["hooks"],
		hookStages: ["run_start", "tool_call_before", "tool_call_after", "run_end"],
	},
	onRunStart({ userMessage }) {
		console.log(`\n[metrics] started: "${userMessage}"`);
		return undefined;
	},
	onToolCall({ call }) {
		console.log(`[metrics] -> ${call.name}`, call.input);
		return undefined;
	},
	onToolResult({ record }) {
		console.log(`[metrics] <- ${record.name} (${record.durationMs}ms)`);
		return undefined;
	},
	onRunEnd({ result }) {
		const { finishReason, iterations, usage } = result;
		console.log(
			`[metrics] done in ${iterations} iteration(s), reason: ${finishReason}`,
		);
		console.log(
			`[metrics] tokens — in: ${usage.inputTokens}, out: ${usage.outputTokens}`,
		);
	},
};

// =============================================================================
// Wire it up
// =============================================================================

const agent = new Agent({
	providerId: "anthropic",
	modelId: "claude-sonnet-4-6",
	apiKey: process.env.ANTHROPIC_API_KEY,
	systemPrompt: "You are a helpful assistant. Use tools when needed.",
	tools: [], // tools registered by plugins are merged in automatically
	extensions: [weatherPlugin, metricsPlugin],
});

const result = await agent.run("What's the weather like in Tokyo and Paris?");
console.log(`\n${result.text}`);
