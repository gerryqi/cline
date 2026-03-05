/**
 * Types and Zod Schemas for the Agent Package
 *
 * This module defines all TypeScript types and Zod validation schemas
 * for agent configuration, tools, events, and results.
 */

import { z } from "zod";

// =============================================================================
// JSON Schema Types (for tool input validation)
// =============================================================================

/**
 * JSON Schema for tool input parameters
 */
export type JsonSchema = {
	type: "object";
	properties: Record<string, JsonSchemaProperty>;
	required?: string[];
	additionalProperties?: boolean;
	description?: string;
};

export type JsonSchemaProperty = {
	type:
		| "string"
		| "number"
		| "integer"
		| "boolean"
		| "array"
		| "object"
		| "null";
	description?: string;
	enum?: unknown[];
	items?: JsonSchemaProperty;
	properties?: Record<string, JsonSchemaProperty>;
	required?: string[];
	default?: unknown;
	minimum?: number;
	maximum?: number;
	minLength?: number;
	maxLength?: number;
	pattern?: string;
};

export const JsonSchemaPropertySchema: z.ZodType<JsonSchemaProperty> = z.lazy(
	() =>
		z.object({
			type: z.enum([
				"string",
				"number",
				"integer",
				"boolean",
				"array",
				"object",
				"null",
			]),
			description: z.string().optional(),
			enum: z.array(z.unknown()).optional(),
			items: JsonSchemaPropertySchema.optional(),
			properties: z.record(z.string(), JsonSchemaPropertySchema).optional(),
			required: z.array(z.string()).optional(),
			default: z.unknown().optional(),
			minimum: z.number().optional(),
			maximum: z.number().optional(),
			minLength: z.number().optional(),
			maxLength: z.number().optional(),
			pattern: z.string().optional(),
		}),
);

export const JsonSchemaSchema = z.object({
	type: z.literal("object"),
	properties: z.record(z.string(), JsonSchemaPropertySchema),
	required: z.array(z.string()).optional(),
	additionalProperties: z.boolean().optional(),
	description: z.string().optional(),
});

// =============================================================================
// Tool Context
// =============================================================================

/**
 * Context passed to tool execution functions
 */
export interface ToolContext {
	/** Unique identifier for the agent instance */
	agentId: string;
	/** Unique identifier for the current conversation */
	conversationId: string;
	/** Current iteration number in the agentic loop */
	iteration: number;
	/** Abort signal for cancellation */
	abortSignal?: AbortSignal;
	/** Optional metadata for the tool execution */
	metadata?: Record<string, unknown>;
}

export interface ToolPolicy {
	/**
	 * Whether the tool can be executed at all.
	 * @default true
	 */
	enabled?: boolean;
	/**
	 * Whether this tool can run without asking the client for approval.
	 * @default true
	 */
	autoApprove?: boolean;
}

export const ToolContextSchema = z.object({
	agentId: z.string(),
	conversationId: z.string(),
	iteration: z.number(),
	abortSignal: z.custom<AbortSignal>().optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
});

// =============================================================================
// Tool Definition
// =============================================================================

/**
 * A tool that the agent can use
 *
 * @template TInput - The type of the input to the tool
 * @template TOutput - The type of the output from the tool
 */
export interface Tool<TInput = unknown, TOutput = unknown> {
	/** Unique name for the tool */
	name: string;
	/** Human-readable description of what the tool does */
	description: string;
	/** JSON Schema defining the tool's input parameters */
	inputSchema: JsonSchema;
	/** The function that executes the tool */
	execute: (input: TInput, context: ToolContext) => Promise<TOutput>;
	/**
	 * Optional timeout in milliseconds for tool execution
	 * @default 30000 (30 seconds)
	 */
	timeoutMs?: number;
	/**
	 * Whether the tool can be retried on failure
	 * @default true
	 */
	retryable?: boolean;
	/**
	 * Maximum number of retries for this tool
	 * @default 2
	 */
	maxRetries?: number;
}

// =============================================================================
// Tool Call Record
// =============================================================================

/**
 * Record of a tool call execution
 */
export interface ToolCallRecord {
	/** Unique identifier for this tool call */
	id: string;
	/** Name of the tool that was called */
	name: string;
	/** Input passed to the tool */
	input: unknown;
	/** Output returned from the tool (if successful) */
	output: unknown;
	/** Error message (if the tool failed) */
	error?: string;
	/** Time taken to execute the tool in milliseconds */
	durationMs: number;
	/** Timestamp when the tool call started */
	startedAt: Date;
	/** Timestamp when the tool call ended */
	endedAt: Date;
}

export interface ToolApprovalRequest {
	agentId: string;
	conversationId: string;
	iteration: number;
	toolCallId: string;
	toolName: string;
	input: unknown;
	policy: ToolPolicy;
}

export interface ToolApprovalResult {
	approved: boolean;
	reason?: string;
}

export const ToolCallRecordSchema = z.object({
	id: z.string(),
	name: z.string(),
	input: z.unknown(),
	output: z.unknown(),
	error: z.string().optional(),
	durationMs: z.number(),
	startedAt: z.date(),
	endedAt: z.date(),
});
