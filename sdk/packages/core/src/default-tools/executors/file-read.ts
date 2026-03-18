/**
 * File Read Executor
 *
 * Built-in implementation for reading files using Node.js fs module.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ToolContext } from "@clinebot/agents";
import type { FileReadExecutor } from "../types.js";

/**
 * Options for the file read executor
 */
export interface FileReadExecutorOptions {
	/**
	 * Maximum file size to read in bytes
	 * @default 10_000_000 (10MB)
	 */
	maxFileSizeBytes?: number;

	/**
	 * File encoding
	 * @default "utf-8"
	 */
	encoding?: BufferEncoding;

	/**
	 * Whether to include line numbers in output
	 * @default false
	 */
	includeLineNumbers?: boolean;
}

/**
 * Create a file read executor using Node.js fs module
 *
 * @example
 * ```typescript
 * const readFile = createFileReadExecutor({
 *   maxFileSizeBytes: 5_000_000, // 5MB limit
 *   includeLineNumbers: true,
 * })
 *
 * const content = await readFile("/path/to/file.ts", context)
 * ```
 */
export function createFileReadExecutor(
	options: FileReadExecutorOptions = {},
): FileReadExecutor {
	const {
		maxFileSizeBytes = 10_000_000,
		encoding = "utf-8",
		includeLineNumbers = false,
	} = options;

	return async (filePath: string, _context: ToolContext): Promise<string> => {
		const resolvedPath = path.isAbsolute(filePath)
			? path.normalize(filePath)
			: path.resolve(process.cwd(), filePath);

		// Check if file exists
		const stat = await fs.stat(resolvedPath);

		if (!stat.isFile()) {
			throw new Error(`Path is not a file: ${resolvedPath}`);
		}

		// Check file size
		if (stat.size > maxFileSizeBytes) {
			throw new Error(
				`File too large: ${stat.size} bytes (max: ${maxFileSizeBytes} bytes). ` +
					`Consider reading specific sections or using a different approach.`,
			);
		}

		// Read file content
		const content = await fs.readFile(resolvedPath, encoding);

		// Optionally add line numbers
		if (includeLineNumbers) {
			const lines = content.split("\n");
			const maxLineNumWidth = String(lines.length).length;
			return lines
				.map(
					(line, i) =>
						`${String(i + 1).padStart(maxLineNumWidth, " ")} | ${line}`,
				)
				.join("\n");
		}

		return content;
	};
}
