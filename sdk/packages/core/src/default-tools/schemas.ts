/**
 * Zod Schemas for Default Tool Inputs
 *
 * These schemas define the input structure for each default tool
 * and are used for both validation and JSON Schema generation.
 */

import { z } from "zod";

/**
 * Schema for read tool input
 */
const AbsolutePath = z
	.string()
	.describe("The absolute file path of a text file to read content from");

/**
 * Schema for read_files tool input
 */
export const ReadFilesInputSchema = z.object({
	file_paths: z.array(AbsolutePath).describe("Array of absolute file paths"),
});
export const ReadFilesInputUnionSchema = z.union([
	ReadFilesInputSchema,
	z.array(z.string()),
	z.string(),
]);

/**
 * Schema for search_codebase tool input
 */
export const SearchCodebaseInputSchema = z.object({
	queries: z
		.array(z.string())
		.describe("Array of regex search queries to execute"),
});

/**
 * Schema for run_commands tool input
 */
export const RunCommandsInputSchema = z.object({
	commands: z.array(z.string()).describe("Array of shell commands to execute"),
});
export const RunCommandsInputUnionSchema = z.union([
	RunCommandsInputSchema,
	z.array(z.string()),
	z.string(),
]);

/**
 * Schema for a single web fetch request
 */
export const WebFetchRequestSchema = z.object({
	url: z.url().describe("The URL to fetch"),
	prompt: z.string().min(2).describe("Analysis prompt for the fetched content"),
});

/**
 * Schema for fetch_web_content tool input
 */
export const FetchWebContentInputSchema = z.object({
	requests: z
		.array(WebFetchRequestSchema)
		.describe("Array of web fetch requests"),
});

/**
 * Schema for editor tool input
 */
export const EditFileInputSchema = z
	.object({
		command: z
			.enum(["create", "str_replace", "insert"])
			.describe(
				"Editor command to execute: create, str_replace, insert, or undo_edit",
			),
		path: z.string().min(1).describe("Absolute file path"),
		file_text: z
			.string()
			.optional()
			.describe("Full file content used with create"),
		old_str: z
			.string()
			.optional()
			.describe("Exact text to replace (must match exactly once)"),
		new_str: z.string().optional().describe("Replacement or inserted text"),
		insert_line: z
			.number()
			.int()
			.optional()
			.describe("Zero-based line index for insert"),
	})
	.superRefine((value, ctx) => {
		switch (value.command) {
			case "create":
				if (value.file_text === undefined) {
					ctx.addIssue({
						code: z.ZodIssueCode.custom,
						path: ["file_text"],
						message: "file_text is required for command=create",
					});
				}
				break;
			case "str_replace":
				if (value.old_str === undefined) {
					ctx.addIssue({
						code: z.ZodIssueCode.custom,
						path: ["old_str"],
						message: "old_str is required for command=str_replace",
					});
				}
				break;
			case "insert":
				if (value.insert_line === undefined) {
					ctx.addIssue({
						code: z.ZodIssueCode.custom,
						path: ["insert_line"],
						message: "insert_line is required for command=insert",
					});
				}
				if (value.new_str === undefined) {
					ctx.addIssue({
						code: z.ZodIssueCode.custom,
						path: ["new_str"],
						message: "new_str is required for command=insert",
					});
				}
				break;
		}
	});

/**
 * Schema for apply_patch tool input
 */
export const ApplyPatchInputSchema = z.object({
	input: z
		.string()
		.min(1)
		.describe("The apply_patch text payload, including patch instructions"),
});
export const ApplyPatchInputUnionSchema = z.union([
	ApplyPatchInputSchema,
	z.string(),
]);

/**
 * Schema for skills tool input
 */
export const SkillsInputSchema = z.object({
	skill: z
		.string()
		.min(1)
		.describe(
			'The skill name. E.g., "commit", "review-pr", "pdf", or "ms-office-suite:pdf"',
		),
	args: z.string().optional().describe("Optional arguments for the skill"),
});

/**
 * Schema for ask_followup_question tool input
 */
export const AskQuestionInputSchema = z.object({
	question: z
		.string()
		.min(1)
		.describe(
			'The single question to ask the user. E.g. "How can I help you?"',
		),
	options: z
		.array(z.string().min(1))
		.min(2)
		.max(5)
		.describe(
			"Array of 2-5 user-selectable answer options for the single question",
		),
});

// =============================================================================
// Type Definitions (derived from Zod schemas)
// =============================================================================

/**
 * Input for the read_files tool
 */
export type ReadFilesInput = z.infer<typeof ReadFilesInputSchema>;

/**
 * Input for the search_codebase tool
 */
export type SearchCodebaseInput = z.infer<typeof SearchCodebaseInputSchema>;

/**
 * Input for the run_commands tool
 */
export type RunCommandsInput = z.infer<typeof RunCommandsInputSchema>;

/**
 * Web fetch request parameters
 */
export type WebFetchRequest = z.infer<typeof WebFetchRequestSchema>;

/**
 * Input for the fetch_web_content tool
 */
export type FetchWebContentInput = z.infer<typeof FetchWebContentInputSchema>;

/**
 * Input for the editor tool
 */
export type EditFileInput = z.infer<typeof EditFileInputSchema>;

/**
 * Input for the apply_patch tool
 */
export type ApplyPatchInput = z.infer<typeof ApplyPatchInputSchema>;

/**
 * Input for the skills tool
 */
export type SkillsInput = z.infer<typeof SkillsInputSchema>;

/**
 * Input for the ask_followup_question tool
 */
export type AskQuestionInput = z.infer<typeof AskQuestionInputSchema>;
