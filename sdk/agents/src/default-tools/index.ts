/**
 * Default Tools
 *
 * This module provides a set of configurable default tools for agents.
 */

// Constants
export { ALL_DEFAULT_TOOL_NAMES, DefaultToolNames } from "./constants.js";

// Tool Definitions
export {
	createBashTool,
	createDefaultTools,
	createEditorTool,
	createReadFilesTool,
	createSearchTool,
	createWebFetchTool,
} from "./definitions.js";
// Built-in Executors
export {
	type BashExecutorOptions,
	createBashExecutor,
	createDefaultExecutors,
	createEditorExecutor,
	createFileReadExecutor,
	createSearchExecutor,
	createWebFetchExecutor,
	type DefaultExecutorsOptions,
	type EditorExecutorOptions,
	type FileReadExecutorOptions,
	type SearchExecutorOptions,
	type WebFetchExecutorOptions,
} from "./executors/index.js";
// Presets
export {
	createDefaultToolsWithPreset,
	type ToolPresetName,
	ToolPresets,
} from "./presets.js";
// Schemas
export {
	type EditFileInput,
	EditFileInputSchema,
	type FetchWebContentInput,
	FetchWebContentInputSchema,
	type ReadFilesInput,
	ReadFilesInputSchema,
	type RunCommandsInput,
	RunCommandsInputSchema,
	type SearchCodebaseInput,
	SearchCodebaseInputSchema,
	type WebFetchRequest,
	WebFetchRequestSchema,
} from "./schemas.js";
// Types
export type {
	BashExecutor,
	CreateDefaultToolsOptions,
	DefaultToolName,
	DefaultToolsConfig,
	EditorExecutor,
	EditorExecutorInput,
	FileReadExecutor,
	SearchExecutor,
	ToolExecutors,
	ToolOperationResult,
	WebFetchExecutor,
} from "./types.js";
// Zod Utilities
export { validateWithZod, zodToJsonSchema } from "./zod-utils.js";

// =============================================================================
// Convenience: Create Tools with Built-in Executors
// =============================================================================

import type { Tool } from "../types.js";
import { createDefaultTools } from "./definitions.js";
import {
	createDefaultExecutors,
	type DefaultExecutorsOptions,
} from "./executors/index.js";
import type { CreateDefaultToolsOptions } from "./types.js";

/**
 * Options for creating default tools with built-in executors
 */
export interface CreateBuiltinToolsOptions
	extends Omit<CreateDefaultToolsOptions, "executors"> {
	/**
	 * Configuration for the built-in executors
	 */
	executorOptions?: DefaultExecutorsOptions;
}

/**
 * Create default tools with built-in Node.js executors
 *
 * This is a convenience function that creates the default tools with
 * working implementations using Node.js built-in modules.
 *
 * @example
 * ```typescript
 * import { Agent, createBuiltinTools } from "@cline/agents"
 *
 * const tools = createBuiltinTools({
 *   cwd: "/path/to/project",
 *   enableBash: true,
 *   enableWebFetch: false, // Disable web fetching
 *   executorOptions: {
 *     bash: { timeoutMs: 60000 },
 *   },
 * })
 *
 * const agent = new Agent({
 *   providerId: "anthropic",
 *   modelId: "claude-sonnet-4-20250514",
 *   systemPrompt: "You are a coding assistant.",
 *   tools,
 * })
 * ```
 */
export function createBuiltinTools(
	options: CreateBuiltinToolsOptions = {},
): Tool[] {
	const { executorOptions = {}, ...toolsConfig } = options;

	const executors = createDefaultExecutors(executorOptions);

	return createDefaultTools({
		...toolsConfig,
		executors,
	});
}
