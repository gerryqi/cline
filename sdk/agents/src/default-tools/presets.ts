/**
 * Tool Presets
 *
 * Pre-configured tool combinations for common use cases.
 */

import type { Tool } from "../types.js";
import { createDefaultTools } from "./definitions.js";
import type { CreateDefaultToolsOptions, DefaultToolsConfig } from "./types.js";

/**
 * Preset configurations for common use cases
 */
export const ToolPresets = {
	/**
	 * Search-focused tools (read_files + search_codebase)
	 * Good for code exploration and analysis agents
	 */
	search: {
		enableReadFiles: true,
		enableSearch: true,
		enableBash: false,
		enableWebFetch: false,
		enableEditor: false,
	},

	/**
	 * Full development tools (all tools enabled)
	 * Good for coding assistants and task automation
	 */
	development: {
		enableReadFiles: true,
		enableSearch: true,
		enableBash: true,
		enableWebFetch: true,
		enableEditor: true,
	},

	/**
	 * Read-only tools (no shell access)
	 * Good for analysis and documentation agents
	 */
	readonly: {
		enableReadFiles: true,
		enableSearch: true,
		enableBash: false,
		enableWebFetch: true,
		enableEditor: false,
	},

	/**
	 * Minimal tools (file reading only)
	 * Good for focused single-file tasks
	 */
	minimal: {
		enableReadFiles: true,
		enableSearch: false,
		enableBash: false,
		enableWebFetch: false,
		enableEditor: false,
	},
} as const satisfies Record<string, DefaultToolsConfig>;

/**
 * Type for preset names
 */
export type ToolPresetName = keyof typeof ToolPresets;

/**
 * Create default tools using a preset configuration
 *
 * @example
 * ```typescript
 * const tools = createDefaultToolsWithPreset("readonly", {
 *   executors: {
 *     readFile: async (path) => fs.readFile(path, "utf-8"),
 *     search: async (query, cwd) => searchFiles(query, cwd),
 *     webFetch: async (url, prompt) => fetchAndAnalyze(url, prompt),
 *   },
 *   cwd: "/path/to/project",
 * })
 * ```
 */
export function createDefaultToolsWithPreset(
	presetName: ToolPresetName,
	options: Omit<CreateDefaultToolsOptions, keyof DefaultToolsConfig> &
		Partial<DefaultToolsConfig>,
): Tool[] {
	const preset = ToolPresets[presetName];
	return createDefaultTools({
		...preset,
		...options,
	});
}
