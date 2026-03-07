import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentConfig, Tool, ToolContext } from "@cline/agents";
import { describe, expect, it } from "vitest";
import { loadSandboxedPlugins } from "./plugin-sandbox";

function createApiCapture() {
	const tools: Tool[] = [];
	const api = {
		registerTool: (tool: Tool) => tools.push(tool),
		registerCommand: () => {},
		registerShortcut: () => {},
		registerFlag: () => {},
		registerMessageRenderer: () => {},
		registerProvider: () => {},
	};
	return { tools, api };
}

describe("plugin-sandbox", () => {
	it("runs plugin hooks and tool contributions in sandbox process", async () => {
		const dir = await mkdtemp(join(tmpdir(), "core-plugin-sandbox-"));
		try {
			const pluginPath = join(dir, "plugin.mjs");
			await writeFile(
				pluginPath,
				[
					"export default {",
					"  name: 'sandbox-test',",
					"  manifest: { capabilities: ['hooks','tools'], hookStages: ['input'] },",
					"  setup(api) {",
					"    api.registerTool({",
					"      name: 'sandbox_echo',",
					"      description: 'echo',",
					"      inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] },",
					"      execute: async (input) => ({ echoed: input.value }),",
					"    });",
					"  },",
					"  onInput(ctx) { return { overrideInput: String(ctx.input || '').toUpperCase() }; }",
					"};",
				].join("\n"),
				"utf8",
			);

			const sandboxed = await loadSandboxedPlugins({
				pluginPaths: [pluginPath],
			});
			try {
				expect(sandboxed.extensions).toBeDefined();
				const extension = sandboxed.extensions?.[0];
				expect(extension?.name).toBe("sandbox-test");
				type AgentExtensionInputContext = Parameters<
					NonNullable<NonNullable<AgentConfig["extensions"]>[number]["onInput"]>
				>[0];
				const inputContext: AgentExtensionInputContext = {
					agentId: "agent-1",
					conversationId: "conv-1",
					parentAgentId: null,
					mode: "run",
					input: "hello",
				};
				const control = await extension?.onInput?.(inputContext);
				expect(control?.overrideInput).toBe("HELLO");

				const { tools, api } = createApiCapture();
				await extension?.setup?.(api);
				expect(tools.map((tool) => tool.name)).toContain("sandbox_echo");
				const echoTool = tools.find((tool) => tool.name === "sandbox_echo");
				expect(echoTool).toBeDefined();
				const result = await echoTool?.execute({ value: "ok" }, {
					agentId: "agent-1",
					conversationId: "conv-1",
					iteration: 1,
				} as ToolContext);
				expect(result).toEqual({ echoed: "ok" });
			} finally {
				await sandboxed.shutdown();
			}
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("enforces hook timeout and cancels sandbox process", async () => {
		const dir = await mkdtemp(join(tmpdir(), "core-plugin-sandbox-timeout-"));
		try {
			const pluginPath = join(dir, "plugin-timeout.mjs");
			await writeFile(
				pluginPath,
				[
					"export default {",
					"  name: 'sandbox-timeout',",
					"  manifest: { capabilities: ['hooks'], hookStages: ['input'] },",
					"  onInput() { return new Promise(() => {}); }",
					"};",
				].join("\n"),
				"utf8",
			);

			const sandboxed = await loadSandboxedPlugins({
				pluginPaths: [pluginPath],
				hookTimeoutMs: 50,
			});
			const extension = sandboxed.extensions?.[0];
			await expect(
				extension?.onInput?.({
					agentId: "agent-1",
					conversationId: "conv-1",
					parentAgentId: null,
					mode: "run",
					input: "hello",
				}),
			).rejects.toThrow(/timed out/i);
			await sandboxed.shutdown();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
