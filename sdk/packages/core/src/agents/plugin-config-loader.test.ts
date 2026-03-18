import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setHomeDir } from "@clinebot/shared/storage";
import { afterEach, describe, expect, it } from "vitest";
import {
	discoverPluginModulePaths,
	resolveAgentPluginPaths,
	resolvePluginConfigSearchPaths,
} from "./plugin-config-loader";

describe("plugin-config-loader", () => {
	const envSnapshot = {
		HOME: process.env.HOME,
	};

	afterEach(() => {
		process.env.HOME = envSnapshot.HOME;
		setHomeDir(envSnapshot.HOME ?? "~");
	});

	it("discovers plugin modules recursively", async () => {
		const root = await mkdtemp(join(tmpdir(), "core-plugin-config-loader-"));
		try {
			const nested = join(root, "nested");
			await mkdir(nested, { recursive: true });
			await writeFile(join(root, "a.mjs"), "export default {}", "utf8");
			await writeFile(join(nested, "b.ts"), "export default {}", "utf8");
			await writeFile(join(root, "ignore.txt"), "noop", "utf8");

			const discovered = discoverPluginModulePaths(root);
			expect(discovered).toEqual([join(root, "a.mjs"), join(nested, "b.ts")]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("resolves plugin paths from explicit files/directories", async () => {
		const root = await mkdtemp(join(tmpdir(), "core-plugin-config-loader-"));
		try {
			const pluginsDir = join(root, "plugins");
			await mkdir(pluginsDir, { recursive: true });
			const filePath = join(root, "direct.mjs");
			const dirPluginPath = join(pluginsDir, "dir-plugin.mjs");
			await writeFile(filePath, "export default {}", "utf8");
			await writeFile(dirPluginPath, "export default {}", "utf8");

			const resolved = resolveAgentPluginPaths({
				pluginPaths: ["./direct.mjs", "./plugins"],
				workspacePath: join(root, "workspace"),
				cwd: root,
			});

			expect(resolved).toEqual([filePath, dirPluginPath]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("includes shared search-path plugins", async () => {
		const home = await mkdtemp(
			join(tmpdir(), "core-plugin-config-loader-home-"),
		);
		const workspace = await mkdtemp(
			join(tmpdir(), "core-plugin-config-loader-workspace-"),
		);
		try {
			process.env.HOME = home;
			setHomeDir(home);
			const workspacePlugins = join(workspace, ".clinerules", "plugins");
			const userPlugins = join(home, ".cline", "plugins");
			await mkdir(workspacePlugins, { recursive: true });
			await mkdir(userPlugins, { recursive: true });
			const workspacePlugin = join(workspacePlugins, "workspace.mjs");
			const userPlugin = join(userPlugins, "user.mjs");
			await writeFile(workspacePlugin, "export default {}", "utf8");
			await writeFile(userPlugin, "export default {}", "utf8");

			const searchPaths = resolvePluginConfigSearchPaths(workspace);
			expect(searchPaths).toContain(workspacePlugins);
			expect(searchPaths).toContain(userPlugins);

			const resolved = resolveAgentPluginPaths({ workspacePath: workspace });
			expect(resolved).toContain(workspacePlugin);
			expect(resolved).toContain(userPlugin);
		} finally {
			await rm(home, { recursive: true, force: true });
			await rm(workspace, { recursive: true, force: true });
		}
	});
});
