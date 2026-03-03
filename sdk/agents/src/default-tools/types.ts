/**
 * Types for Default Tools
 *
 * Type definitions for executors, configuration, and results.
 */

import type { ToolContext } from "../types.js";

// =============================================================================
// Tool Result Types
// =============================================================================

/**
 * Result from a single tool operation
 */
export interface ToolOperationResult {
	/** The query/input that was executed */
	query: string;
	/** The result content (if successful) */
	result: string;
	/** Error message (if failed) */
	error?: string;
	/** Whether the operation succeeded */
	success: boolean;
}

// =============================================================================
// Executor Interfaces
// =============================================================================

/**
 * Executor for reading files
 *
 * @param filePath - Absolute path to the file to read
 * @param context - Tool execution context
 * @returns The file content as a string
 */
export type FileReadExecutor = (
	filePath: string,
	context: ToolContext,
) => Promise<string>;

/**
 * Executor for searching the codebase
 *
 * @param query - Regex pattern to search for
 * @param cwd - Current working directory for the search
 * @param context - Tool execution context
 * @returns Search results as a formatted string
 */
export type SearchExecutor = (
	query: string,
	cwd: string,
	context: ToolContext,
) => Promise<string>;

/**
 * Executor for running shell commands
 *
 * @param command - Shell command to execute
 * @param cwd - Current working directory for execution
 * @param context - Tool execution context
 * @returns Command output (stdout)
 */
export type BashExecutor = (
	command: string,
	cwd: string,
	context: ToolContext,
) => Promise<string>;

/**
 * Executor for fetching web content
 *
 * @param url - URL to fetch
 * @param prompt - Analysis prompt for the content
 * @param context - Tool execution context
 * @returns Analyzed/extracted content
 */
export type WebFetchExecutor = (
	url: string,
	prompt: string,
	context: ToolContext,
) => Promise<string>;

/**
 * Input for the editor executor
 */
export interface EditorExecutorInput {
	command: "create" | "str_replace" | "insert" | "undo_edit";
	path: string;
	file_text?: string;
	old_str?: string;
	new_str?: string;
	insert_line?: number;
}

/**
 * Executor for editing files
 *
 * @param input - Editor command input
 * @param cwd - Current working directory for filesystem operations
 * @param context - Tool execution context
 * @returns A formatted operation result string
 */
export type EditorExecutor = (
	input: EditorExecutorInput,
	cwd: string,
	context: ToolContext,
) => Promise<string>;

/**
 * Executor for invoking configured skills
 *
 * @param skill - Skill name to invoke
 * @param args - Optional arguments for the skill
 * @param context - Tool execution context
 * @returns Skill loading/invocation result
 */
export type SkillsExecutor = (
	skill: string,
	args: string | undefined,
	context: ToolContext,
) => Promise<string>;

/**
 * Skill metadata exposed by SkillsExecutor for clients/UI
 */
export interface SkillsExecutorSkillMetadata {
	/** Normalized skill id (usually lowercased name) */
	id: string;
	/** Display name for the skill */
	name: string;
	/** Optional short description */
	description?: string;
	/** True when configured but intentionally disabled */
	disabled: boolean;
}

/**
 * A callable executor that can also expose configured skill metadata.
 */
export interface SkillsExecutorWithMetadata {
	(
		skill: string,
		args: string | undefined,
		context: ToolContext,
	): Promise<string>;
	configuredSkills?: SkillsExecutorSkillMetadata[];
}

/**
 * Collection of all tool executors
 */
export interface ToolExecutors {
	/** File reading implementation */
	readFile?: FileReadExecutor;
	/** Codebase search implementation */
	search?: SearchExecutor;
	/** Shell command execution implementation */
	bash?: BashExecutor;
	/** Web content fetching implementation */
	webFetch?: WebFetchExecutor;
	/** Filesystem editor implementation */
	editor?: EditorExecutor;
	/** Skill invocation implementation */
	skills?: SkillsExecutorWithMetadata;
}

// =============================================================================
// Tool Configuration
// =============================================================================

/**
 * Names of available default tools
 */
export type DefaultToolName =
	| "read_files"
	| "search_codebase"
	| "run_commands"
	| "fetch_web_content"
	| "editor"
	| "skills";

/**
 * Configuration for enabling/disabling default tools
 */
export interface DefaultToolsConfig {
	/**
	 * Enable the read_files tool
	 * @default true
	 */
	enableReadFiles?: boolean;

	/**
	 * Enable the search_codebase tool
	 * @default true
	 */
	enableSearch?: boolean;

	/**
	 * Enable the run_commands tool
	 * @default true
	 */
	enableBash?: boolean;

	/**
	 * Enable the fetch_web_content tool
	 * @default true
	 */
	enableWebFetch?: boolean;

	/**
	 * Enable the editor tool
	 * @default true
	 */
	enableEditor?: boolean;

	/**
	 * Enable the skills tool
	 * @default true
	 */
	enableSkills?: boolean;

	/**
	 * Current working directory for tools that need it
	 */
	cwd?: string;

	/**
	 * Timeout for file read operations in milliseconds
	 * @default 10000
	 */
	fileReadTimeoutMs?: number;

	/**
	 * Timeout for bash command execution in milliseconds
	 * @default 30000
	 */
	bashTimeoutMs?: number;

	/**
	 * Timeout for web fetch operations in milliseconds
	 * @default 30000
	 */
	webFetchTimeoutMs?: number;

	/**
	 * Timeout for search operations in milliseconds
	 * @default 30000
	 */
	searchTimeoutMs?: number;

	/**
	 * Timeout for editor operations in milliseconds
	 * @default 30000
	 */
	editorTimeoutMs?: number;

	/**
	 * Timeout for skills operations in milliseconds
	 * @default 15000
	 */
	skillsTimeoutMs?: number;
}

/**
 * Options for creating default tools
 */
export interface CreateDefaultToolsOptions extends DefaultToolsConfig {
	/**
	 * Executor implementations for the tools
	 * Only tools with provided executors will be available
	 */
	executors: ToolExecutors;
}
