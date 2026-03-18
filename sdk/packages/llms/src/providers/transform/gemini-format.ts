/**
 * Gemini Message Format Converter
 *
 * Converts our unified Message format to Google Gemini's Content format.
 */

import { formatFileContentBlock } from "@clinebot/shared";
import type { Content, FunctionDeclaration, Part } from "@google/genai";
import type {
	ContentBlock,
	FileContent,
	ImageContent,
	Message,
	TextContent,
	ThinkingContent,
	ToolResultContent,
	ToolUseContent,
} from "../types/messages";
import {
	normalizeToolUseInput,
	serializeToolResultContent,
} from "./content-format";

/**
 * Convert messages to Gemini format
 */
export function convertToGeminiMessages(messages: Message[]): Content[] {
	const toolNameByCallId = new Map<string, string>();
	return messages
		.map((message) => convertMessage(message, toolNameByCallId))
		.filter((m): m is Content => m !== null);
}

function convertMessage(
	message: Message,
	toolNameByCallId: Map<string, string>,
): Content | null {
	const { role, content } = message;

	// Map roles: Gemini uses "user" and "model"
	const geminiRole = role === "assistant" ? "model" : "user";

	// Simple string content
	if (typeof content === "string") {
		return {
			role: geminiRole,
			parts: [{ text: content }],
		};
	}

	// Array content
	const parts = convertContentBlocks(content, toolNameByCallId);
	if (parts.length === 0) {
		return null;
	}

	return {
		role: geminiRole,
		parts,
	};
}

function convertContentBlocks(
	content: ContentBlock[],
	toolNameByCallId: Map<string, string>,
): Part[] {
	const parts: Part[] = [];

	for (const block of content) {
		if (block.type === "tool_use") {
			toolNameByCallId.set(block.id, block.name);
		}
		const converted = convertContentBlock(block, toolNameByCallId);
		if (converted) {
			parts.push(converted);
		}
	}

	return parts;
}

function convertContentBlock(
	block: ContentBlock,
	toolNameByCallId: Map<string, string>,
): Part | null {
	switch (block.type) {
		case "text": {
			const textBlock = block as TextContent;
			const part: Part = { text: textBlock.text };
			if (textBlock.signature) {
				(part as any).thoughtSignature = textBlock.signature;
			}
			return part;
		}

		case "file": {
			const fileBlock = block as FileContent;
			const part: Part = {
				text: formatFileContentBlock(fileBlock.path, fileBlock.content),
			};

			return part;
		}

		case "image": {
			const imageBlock = block as ImageContent;
			return {
				inlineData: {
					mimeType: imageBlock.mediaType,
					data: imageBlock.data,
				},
			};
		}

		case "tool_use": {
			const toolBlock = block as ToolUseContent;
			const part: Part = {
				functionCall: {
					id: toolBlock.id,
					name: toolBlock.name,
					args: normalizeToolUseInput(toolBlock.input),
				},
			};
			if (toolBlock.signature) {
				(part as any).thoughtSignature = toolBlock.signature;
			}
			return part;
		}

		case "tool_result": {
			const resultBlock = block as ToolResultContent;
			let responseContent: Record<string, unknown>;

			if (typeof resultBlock.content === "string") {
				responseContent = { result: resultBlock.content };
			} else {
				responseContent = {
					result: serializeToolResultContent(resultBlock.content),
				};
			}

			if (resultBlock.is_error) {
				responseContent.error = true;
			}

			return {
				functionResponse: {
					id: resultBlock.tool_use_id,
					name:
						toolNameByCallId.get(resultBlock.tool_use_id) ??
						resultBlock.tool_use_id,
					response: responseContent,
				},
			};
		}

		case "thinking": {
			const thinkingBlock = block as ThinkingContent;
			// Gemini uses thought: true to mark thinking blocks
			const part = {
				text: thinkingBlock.thinking,
				thought: true,
			} as Part;
			if (thinkingBlock.signature) {
				(part as any).thoughtSignature = thinkingBlock.signature;
			}
			return part;
		}

		default:
			return null;
	}
}

/**
 * Convert tool definitions to Gemini format
 */
export function convertToolsToGemini(
	tools: Array<{ name: string; description: string; inputSchema: unknown }>,
): FunctionDeclaration[] {
	return tools.map((tool) => ({
		name: tool.name,
		description: tool.description,
		parameters: tool.inputSchema as FunctionDeclaration["parameters"],
	}));
}
