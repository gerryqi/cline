/**
 * Tool Validation
 *
 * Functions for validating tools and tool inputs.
 */

import type { Tool } from "../types.js";

/**
 * Validate that all tools have unique names
 */
export function validateTools(tools: Tool[]): void {
	const names = new Set<string>();
	for (const tool of tools) {
		if (names.has(tool.name)) {
			throw new Error(`Duplicate tool name: ${tool.name}`);
		}
		names.add(tool.name);
	}
}

/**
 * Validate tool input against its schema (basic validation)
 *
 * Note: This is a simplified validation. For full JSON Schema validation,
 * consider using a library like ajv.
 */
export function validateToolInput(
	tool: Tool,
	input: unknown,
): { valid: boolean; error?: string } {
	if (typeof input !== "object" || input === null) {
		return { valid: false, error: "Input must be an object" };
	}

	const inputObj = input as Record<string, unknown>;
	const { properties, required } = tool.inputSchema;

	// Check required fields
	if (required) {
		for (const field of required) {
			if (!(field in inputObj)) {
				return { valid: false, error: `Missing required field: ${field}` };
			}
		}
	}

	// Basic type checking for known properties
	for (const [key, value] of Object.entries(inputObj)) {
		const schema = properties[key];
		if (!schema) {
			// Unknown property - might be ok depending on additionalProperties
			continue;
		}

		// Simple type check
		if (value !== null && value !== undefined) {
			const actualType = Array.isArray(value) ? "array" : typeof value;
			const expectedType = schema.type;

			if (expectedType === "integer" && actualType === "number") {
				if (!Number.isInteger(value)) {
					return { valid: false, error: `Field "${key}" must be an integer` };
				}
			} else if (actualType !== expectedType && expectedType !== "null") {
				return {
					valid: false,
					error: `Field "${key}" has wrong type: expected ${expectedType}, got ${actualType}`,
				};
			}
		}
	}

	return { valid: true };
}

/**
 * Validate a tool definition
 */
export function validateToolDefinition(tool: Tool): {
	valid: boolean;
	errors: string[];
} {
	const errors: string[] = [];

	if (!tool.name || typeof tool.name !== "string") {
		errors.push("Tool must have a valid name");
	}

	if (!tool.description || typeof tool.description !== "string") {
		errors.push("Tool must have a description");
	}

	if (!tool.inputSchema || tool.inputSchema.type !== "object") {
		errors.push("Tool must have an inputSchema with type 'object'");
	}

	if (typeof tool.execute !== "function") {
		errors.push("Tool must have an execute function");
	}

	return {
		valid: errors.length === 0,
		errors,
	};
}
