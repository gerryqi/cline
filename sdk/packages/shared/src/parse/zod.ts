/**
 * Zod Utilities
 *
 * Helper functions for working with Zod schemas.
 */

import { z } from "zod";

/**
 * Validate input using a Zod schema
 * Throws a formatted error if validation fails
 */
export function validateWithZod<T>(schema: z.ZodType<T>, input: unknown): T {
	const result = schema.safeParse(stripNullProperties(input));
	if (!result.success) {
		const errors = result.error.issues
			.map((e) => `${e.path.join(".")}: ${e.message}`)
			.join("; ");
		throw new Error(`Invalid input: ${errors}`);
	}
	return result.data;
}

/**
 * Strip null-valued properties from an object so that Zod `.optional()` fields
 * validate correctly. OpenAI strict mode sends `null` for optional fields rather
 * than omitting them.
 */
function stripNullProperties(input: unknown): unknown {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		return input;
	}
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
		if (value !== null) {
			result[key] = value;
		}
	}
	return result;
}

export function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
	return z.toJSONSchema(schema);
}
