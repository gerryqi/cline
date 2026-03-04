/**
 * Zod Utilities
 *
 * Helper functions for working with Zod schemas.
 */

import type { z } from "zod";
import type { JsonSchema } from "../types.js";

/**
 * Get the type name from a Zod schema's internal definition
 */
function getZodTypeName(schema: z.ZodTypeAny): string {
	// Access the internal typeName (exists at runtime but not in types)
	return (schema._def as { typeName?: string }).typeName ?? "unknown";
}

/**
 * Convert a Zod schema to JSON Schema format for tool definitions
 *
 * This is a simplified converter that handles the common cases used
 * in tool input schemas.
 */
export function zodToJsonSchema(schema: z.ZodTypeAny): JsonSchema {
	return convertZodType(schema) as JsonSchema;
}

function convertZodType(schema: z.ZodTypeAny): Record<string, unknown> {
	const typeName = getZodTypeName(schema);

	// Handle ZodObject
	if (typeName === "ZodObject") {
		const objectSchema = schema as z.ZodObject<z.ZodRawShape>;
		const shape = objectSchema.shape;
		const properties: Record<string, unknown> = {};
		const required: string[] = [];

		for (const [key, value] of Object.entries(shape)) {
			const zodValue = value as z.ZodTypeAny;
			properties[key] = convertZodType(zodValue);

			// Check if the field is required (not optional)
			if (!zodValue.isOptional()) {
				required.push(key);
			}
		}

		return {
			type: "object",
			properties,
			...(required.length > 0 ? { required } : {}),
		};
	}

	// Handle ZodArray
	if (typeName === "ZodArray") {
		const arraySchema = schema as z.ZodArray<z.ZodTypeAny>;
		return {
			type: "array",
			items: convertZodType(arraySchema.element),
			...(schema.description ? { description: schema.description } : {}),
		};
	}

	// Handle ZodString
	if (typeName === "ZodString") {
		const stringDef = schema._def as {
			checks?: Array<{ kind?: string; value?: number }>;
		};
		const result: Record<string, unknown> = { type: "string" };

		// Check for URL validation and other constraints
		if (stringDef.checks) {
			for (const check of stringDef.checks) {
				if (check.kind === "url") {
					result.format = "uri";
				}
				if (check.kind === "min") {
					result.minLength = check.value;
				}
				if (check.kind === "max") {
					result.maxLength = check.value;
				}
			}
		}

		if (schema.description) {
			result.description = schema.description;
		}

		return result;
	}

	// Handle ZodEnum
	if (typeName === "ZodEnum") {
		const enumSchema = schema as z.ZodEnum;
		const result: Record<string, unknown> = {
			type: "string",
			enum: enumSchema.options,
		};
		if (schema.description) {
			result.description = schema.description;
		}
		return result;
	}

	// Handle ZodNumber
	if (typeName === "ZodNumber") {
		const result: Record<string, unknown> = { type: "number" };
		if (schema.description) {
			result.description = schema.description;
		}
		return result;
	}

	// Handle ZodBoolean
	if (typeName === "ZodBoolean") {
		const result: Record<string, unknown> = { type: "boolean" };
		if (schema.description) {
			result.description = schema.description;
		}
		return result;
	}

	// Handle ZodOptional
	if (typeName === "ZodOptional") {
		const optionalSchema = schema as z.ZodOptional<z.ZodTypeAny>;
		return convertZodType(optionalSchema.unwrap());
	}

	// Handle ZodDefault
	if (typeName === "ZodDefault") {
		const defaultSchema = schema as z.ZodDefault<z.ZodTypeAny>;
		const inner = convertZodType(defaultSchema.removeDefault());
		return {
			...inner,
			default: (
				schema._def as unknown as { defaultValue: () => unknown }
			).defaultValue(),
		};
	}

	// Handle ZodEffects (refine, superRefine, transform wrappers)
	if (typeName === "ZodEffects") {
		const effectsSchema = schema as z.ZodTypeAny & {
			innerType?: () => z.ZodTypeAny;
		};
		if (effectsSchema.innerType) {
			return convertZodType(effectsSchema.innerType());
		}
	}

	// Default fallback
	return { type: "object" };
}

/**
 * Validate input using a Zod schema
 * Throws a formatted error if validation fails
 */
export function validateWithZod<T>(schema: z.ZodType<T>, input: unknown): T {
	const result = schema.safeParse(input);
	if (!result.success) {
		const errors = result.error.issues
			.map((e) => `${e.path.join(".")}: ${e.message}`)
			.join("; ");
		throw new Error(`Invalid input: ${errors}`);
	}
	return result.data;
}
