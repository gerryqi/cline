import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	loadAgentPluginFromPath,
	loadAgentPluginsFromPaths,
} from "./plugin-loader";

describe("plugin-loader", () => {
	it("loads default-exported plugin from path", async () => {
		const dir = await mkdtemp(join(tmpdir(), "core-plugin-loader-"));
		try {
			const pluginPath = join(dir, "plugin-default.mjs");
			await writeFile(
				pluginPath,
				[
					"export default {",
					"  name: 'from-default',",
					"  manifest: { capabilities: ['hooks'], hookStages: ['input'] },",
					"  onInput: ({ input }) => ({ overrideInput: input })",
					"};",
				].join("\n"),
				"utf8",
			);

			const plugin = await loadAgentPluginFromPath(pluginPath);
			expect(plugin.name).toBe("from-default");
			expect(plugin.manifest.capabilities).toContain("hooks");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("loads named plugin export from path", async () => {
		const dir = await mkdtemp(join(tmpdir(), "core-plugin-loader-"));
		try {
			const pluginPath = join(dir, "plugin-named.mjs");
			await writeFile(
				pluginPath,
				[
					"export const plugin = {",
					"  name: 'from-named',",
					"  manifest: { capabilities: ['tools'] },",
					"};",
				].join("\n"),
				"utf8",
			);

			const plugin = await loadAgentPluginFromPath(pluginPath, {
				exportName: "plugin",
			});
			expect(plugin.name).toBe("from-named");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("loads multiple plugins from file paths", async () => {
		const dir = await mkdtemp(join(tmpdir(), "core-plugin-loader-"));
		try {
			const firstPath = join(dir, "plugin-a.mjs");
			const secondPath = join(dir, "plugin-b.mjs");
			await writeFile(
				firstPath,
				"export default { name: 'plugin-a', manifest: { capabilities: ['tools'] } };",
				"utf8",
			);
			await writeFile(
				secondPath,
				"export default { name: 'plugin-b', manifest: { capabilities: ['commands'] } };",
				"utf8",
			);

			const plugins = await loadAgentPluginsFromPaths([firstPath, secondPath]);
			expect(plugins.map((plugin) => plugin.name)).toEqual([
				"plugin-a",
				"plugin-b",
			]);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("rejects invalid plugin export missing manifest", async () => {
		const dir = await mkdtemp(join(tmpdir(), "core-plugin-loader-"));
		try {
			const pluginPath = join(dir, "invalid-plugin.mjs");
			await writeFile(
				pluginPath,
				"export default { name: 'invalid-plugin' };",
				"utf8",
			);

			await expect(loadAgentPluginFromPath(pluginPath)).rejects.toThrow(
				/missing required "manifest"/i,
			);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
