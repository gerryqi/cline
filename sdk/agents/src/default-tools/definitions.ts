/**
 * Default Tool Definitions
 *
 * Factory functions for creating the default tools.
 */

import { createTool } from "../tools/create.js";
import type { Tool } from "../types.js";
import {
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
} from "./schemas.js";
import type {
	BashExecutor,
	CreateDefaultToolsOptions,
	DefaultToolsConfig,
	EditorExecutor,
	FileReadExecutor,
	SearchExecutor,
	ToolOperationResult,
	WebFetchExecutor,
} from "./types.js";
import { validateWithZod, zodToJsonSchema } from "./zod-utils.js";

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Format an error into a string message
 */
function formatError(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}

/**
 * Create a timeout-wrapped promise
 */
function withTimeout<T>(
	promise: Promise<T>,
	ms: number,
	message: string,
): Promise<T> {
	return Promise.race([
		promise,
		new Promise<never>((_, reject) => {
			setTimeout(() => reject(new Error(message)), ms);
		}),
	]);
}

// =============================================================================
// Tool Factory Functions
// =============================================================================

/**
 * Create the read_files tool
 *
 * Reads the content of one or more files from the filesystem.
 */
export function createReadFilesTool(
	executor: FileReadExecutor,
	config: Pick<DefaultToolsConfig, "fileReadTimeoutMs"> = {},
): Tool<ReadFilesInput, ToolOperationResult[]> {
	const timeoutMs = config.fileReadTimeoutMs ?? 10000;

	return createTool<ReadFilesInput, ToolOperationResult[]>({
		name: "read_files",
		description:
			"Read the full content of one or more files from the codebase using absolute paths. " +
			"Returns file contents or error messages for each path. " +
			"Use this to examine source code, configuration files, or any text files.",
		inputSchema: zodToJsonSchema(ReadFilesInputSchema),
		timeoutMs: timeoutMs * 2, // Account for multiple files
		retryable: true,
		maxRetries: 1,
		execute: async (input, context) => {
			// Validate input with Zod schema
			const validatedInput = validateWithZod(ReadFilesInputSchema, input);

			return Promise.all(
				validatedInput.file_paths.map(
					async (filePath): Promise<ToolOperationResult> => {
						try {
							const content = await withTimeout(
								executor(filePath, context),
								timeoutMs,
								`File read timed out after ${timeoutMs}ms`,
							);
							return {
								query: filePath,
								result: content,
								success: true,
							};
						} catch (error) {
							const msg = formatError(error);
							return {
								query: filePath,
								result: "",
								error: `Error reading file: ${msg}`,
								success: false,
							};
						}
					},
				),
			);
		},
	});
}

/**
 * Create the search_codebase tool
 *
 * Performs regex pattern searches across the codebase.
 */
export function createSearchTool(
	executor: SearchExecutor,
	config: Pick<DefaultToolsConfig, "cwd" | "searchTimeoutMs"> = {},
): Tool<SearchCodebaseInput, ToolOperationResult[]> {
	const timeoutMs = config.searchTimeoutMs ?? 30000;
	const cwd = config.cwd ?? process.cwd();

	return createTool<SearchCodebaseInput, ToolOperationResult[]>({
		name: "search_codebase",
		description:
			"Perform regex pattern searches across the codebase. " +
			"Supports multiple parallel searches. " +
			"Use for finding code patterns, function definitions, class names, imports, etc.",
		inputSchema: zodToJsonSchema(SearchCodebaseInputSchema),
		timeoutMs: timeoutMs * 2,
		retryable: true,
		maxRetries: 1,
		execute: async (input, context) => {
			// Validate input with Zod schema
			const validatedInput = validateWithZod(SearchCodebaseInputSchema, input);

			return Promise.all(
				validatedInput.queries.map(
					async (query): Promise<ToolOperationResult> => {
						try {
							const results = await withTimeout(
								executor(query, cwd, context),
								timeoutMs,
								`Search timed out after ${timeoutMs}ms`,
							);
							// Check if results contain matches
							const hasResults =
								results.length > 0 && !results.includes("No results found");
							return {
								query,
								result: results,
								success: hasResults,
							};
						} catch (error) {
							const msg = formatError(error);
							return {
								query,
								result: "",
								error: `Search failed: ${msg}`,
								success: false,
							};
						}
					},
				),
			);
		},
	});
}

/**
 * Create the run_commands tool
 *
 * Executes shell commands in the project directory.
 */
export function createBashTool(
	executor: BashExecutor,
	config: Pick<DefaultToolsConfig, "cwd" | "bashTimeoutMs"> = {},
): Tool<RunCommandsInput, ToolOperationResult[]> {
	const timeoutMs = config.bashTimeoutMs ?? 30000;
	const cwd = config.cwd ?? process.cwd();

	return createTool<RunCommandsInput, ToolOperationResult[]>({
		name: "run_commands",
		description:
			"Run shell commands at the root of the project. " +
			"Use for listing files, checking git status, running builds, executing tests, etc. " +
			"Commands should be properly shell-escaped.",
		inputSchema: zodToJsonSchema(RunCommandsInputSchema),
		timeoutMs: timeoutMs * 2,
		retryable: false, // Shell commands often have side effects
		maxRetries: 0,
		execute: async (input, context) => {
			// Validate input with Zod schema
			const validatedInput = validateWithZod(RunCommandsInputSchema, input);

			return Promise.all(
				validatedInput.commands.map(
					async (command): Promise<ToolOperationResult> => {
						try {
							const output = await withTimeout(
								executor(command, cwd, context),
								timeoutMs,
								`Command timed out after ${timeoutMs}ms`,
							);
							return {
								query: command,
								result: output,
								success: true,
							};
						} catch (error) {
							const msg = formatError(error);
							return {
								query: command,
								result: "",
								error: `Command failed: ${msg}`,
								success: false,
							};
						}
					},
				),
			);
		},
	});
}

/**
 * Create the fetch_web_content tool
 *
 * Fetches content from URLs and analyzes them using provided prompts.
 */
export function createWebFetchTool(
	executor: WebFetchExecutor,
	config: Pick<DefaultToolsConfig, "webFetchTimeoutMs"> = {},
): Tool<FetchWebContentInput, ToolOperationResult[]> {
	const timeoutMs = config.webFetchTimeoutMs ?? 30000;

	return createTool<FetchWebContentInput, ToolOperationResult[]>({
		name: "fetch_web_content",
		description:
			"Fetch content from URLs and analyze them using the provided prompts. " +
			"Use for retrieving documentation, API references, or any web content. " +
			"Each request includes a URL and a prompt describing what information to extract.",
		inputSchema: zodToJsonSchema(FetchWebContentInputSchema),
		timeoutMs: timeoutMs * 2,
		retryable: true,
		maxRetries: 2,
		execute: async (input, context) => {
			// Validate input with Zod schema
			const validatedInput = validateWithZod(FetchWebContentInputSchema, input);

			return Promise.all(
				validatedInput.requests.map(
					async (request): Promise<ToolOperationResult> => {
						try {
							const content = await withTimeout(
								executor(request.url, request.prompt, context),
								timeoutMs,
								`Web fetch timed out after ${timeoutMs}ms`,
							);
							return {
								query: request.url,
								result: content,
								success: true,
							};
						} catch (error) {
							const msg = formatError(error);
							return {
								query: request.url,
								result: "",
								error: `Error fetching web content: ${msg}`,
								success: false,
							};
						}
					},
				),
			);
		},
	});
}

/**
 * Create the editor tool
 *
 * Supports controlled filesystem edits with create, replace, and insert commands.
 */
export function createEditorTool(
	executor: EditorExecutor,
	config: Pick<DefaultToolsConfig, "cwd" | "editorTimeoutMs"> = {},
): Tool<EditFileInput, ToolOperationResult> {
	const timeoutMs = config.editorTimeoutMs ?? 30000;
	const cwd = config.cwd ?? process.cwd();

	return createTool<EditFileInput, ToolOperationResult>({
		name: "editor",
		description:
			"Edit files in the workspace with create, string replacement, and line insert operations. " +
			"Supported commands: create, str_replace, insert, undo_edit.",
		inputSchema: zodToJsonSchema(EditFileInputSchema),
		timeoutMs,
		retryable: false, // Editing operations are stateful and should not auto-retry
		maxRetries: 0,
		execute: async (input, context) => {
			const validatedInput = validateWithZod(EditFileInputSchema, input);

			try {
				const result = await withTimeout(
					executor(validatedInput, cwd, context),
					timeoutMs,
					`Editor operation timed out after ${timeoutMs}ms`,
				);

				return {
					query: `${validatedInput.command}:${validatedInput.path}`,
					result,
					success: true,
				};
			} catch (error) {
				const msg = formatError(error);
				return {
					query: `${validatedInput.command}:${validatedInput.path}`,
					result: "",
					error: `Editor operation failed: ${msg}`,
					success: false,
				};
			}
		},
	});
}

// =============================================================================
// Default Tools Factory
// =============================================================================

/**
 * Create a set of default tools for an agent
 *
 * This function creates the default tools based on the provided configuration
 * and executors. Only tools that are enabled AND have an executor provided
 * will be included in the returned array.
 *
 * @example
 * ```typescript
 * import { createDefaultTools, Agent } from "@cline/agents"
 * import * as fs from "fs/promises"
 * import { exec } from "child_process"
 *
 * const tools = createDefaultTools({
 *   executors: {
 *     readFile: async (path) => fs.readFile(path, "utf-8"),
 *     bash: async (cmd, cwd) => {
 *       return new Promise((resolve, reject) => {
 *         exec(cmd, { cwd }, (err, stdout, stderr) => {
 *           if (err) reject(new Error(stderr || err.message))
 *           else resolve(stdout)
 *         })
 *       })
 *     },
 *   },
 *   enableReadFiles: true,
 *   enableBash: true,
 *   enableSearch: false, // Disabled
 *   enableWebFetch: false, // Disabled
 *   cwd: "/path/to/project",
 * })
 *
 * const agent = new Agent({
 *   // ... provider config
 *   tools,
 * })
 * ```
 */
export function createDefaultTools(options: CreateDefaultToolsOptions): Tool[] {
	const {
		executors,
		enableReadFiles = true,
		enableSearch = true,
		enableBash = true,
		enableWebFetch = true,
		enableEditor = true,
		...config
	} = options;

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const tools: Tool<any, any>[] = [];

	// Add read_files tool if enabled and executor provided
	if (enableReadFiles && executors.readFile) {
		tools.push(createReadFilesTool(executors.readFile, config));
	}

	// Add search_codebase tool if enabled and executor provided
	if (enableSearch && executors.search) {
		tools.push(createSearchTool(executors.search, config));
	}

	// Add run_commands tool if enabled and executor provided
	if (enableBash && executors.bash) {
		tools.push(createBashTool(executors.bash, config));
	}

	// Add fetch_web_content tool if enabled and executor provided
	if (enableWebFetch && executors.webFetch) {
		tools.push(createWebFetchTool(executors.webFetch, config));
	}

	// Add editor tool if enabled and executor provided
	if (enableEditor && executors.editor) {
		tools.push(createEditorTool(executors.editor, config));
	}

	return tools;
}
