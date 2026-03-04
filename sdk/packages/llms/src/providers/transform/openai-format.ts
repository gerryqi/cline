/**
 * OpenAI Message Format Converter
 *
 * Converts our unified Message format to OpenAI's ChatCompletionMessageParam format.
 */

import type OpenAI from "openai";
import type {
	ContentBlock,
	ImageContent,
	Message,
	TextContent,
	ToolResultContent,
	ToolUseContent,
} from "../types/messages";

type OpenAIMessage = OpenAI.Chat.ChatCompletionMessageParam;
type OpenAIContentPart = OpenAI.Chat.ChatCompletionContentPart;

/**
 * Convert messages to OpenAI format
 */
export function convertToOpenAIMessages(messages: Message[]): OpenAIMessage[] {
	return messages.flatMap(convertMessage);
}

function convertMessage(message: Message): OpenAIMessage[] {
	const { role, content } = message;

	// Simple string content
	if (typeof content === "string") {
		return [{ role, content } as OpenAIMessage];
	}

	// Array content - need to process blocks
	if (role === "assistant") {
		return [convertAssistantMessage(content)];
	} else {
		return convertUserMessage(content);
	}
}

function convertAssistantMessage(content: ContentBlock[]): OpenAIMessage {
	const textParts: string[] = [];
	const toolCalls: OpenAI.Chat.ChatCompletionMessageToolCall[] = [];

	for (const block of content) {
		switch (block.type) {
			case "text":
				textParts.push((block as TextContent).text);
				break;
			case "tool_use": {
				const toolUse = block as ToolUseContent;
				toolCalls.push({
					id: toolUse.id,
					type: "function",
					function: {
						name: toolUse.name,
						arguments: JSON.stringify(toolUse.input),
					},
				});
				break;
			}
			case "thinking":
				// OpenAI doesn't have native thinking blocks, skip
				break;
		}
	}

	const message: OpenAI.Chat.ChatCompletionAssistantMessageParam = {
		role: "assistant",
		content: textParts.length > 0 ? textParts.join("\n") : null,
	};

	if (toolCalls.length > 0) {
		message.tool_calls = toolCalls;
	}

	return message;
}

function convertUserMessage(content: ContentBlock[]): OpenAIMessage[] {
	const messages: OpenAIMessage[] = [];

	// Convert all tool results to separate tool messages
	const toolResults = content.filter(
		(b) => b.type === "tool_result",
	) as ToolResultContent[];
	for (const result of toolResults) {
		messages.push({
			role: "tool",
			tool_call_id: result.tool_use_id,
			content:
				typeof result.content === "string"
					? result.content
					: JSON.stringify(result.content),
		});
	}

	// Preserve any non-tool user content as a regular user message
	const userContent = content.filter((b) => b.type !== "tool_result");
	if (userContent.length === 0) {
		return messages;
	}

	const parts: OpenAIContentPart[] = [];

	for (const block of userContent) {
		switch (block.type) {
			case "text":
				parts.push({ type: "text", text: (block as TextContent).text });
				break;
			case "image": {
				const img = block as ImageContent;
				parts.push({
					type: "image_url",
					image_url: {
						url: `data:${img.mediaType};base64,${img.data}`,
					},
				});
				break;
			}
		}
	}
	if (parts.length === 0) {
		return messages;
	}

	messages.push({
		role: "user",
		content:
			parts.length === 1 && parts[0].type === "text" ? parts[0].text : parts,
	});

	return messages;
}

/**
 * Convert tool definitions to OpenAI format
 */
export function convertToolsToOpenAI(
	tools: Array<{ name: string; description: string; inputSchema: unknown }>,
): OpenAI.Chat.ChatCompletionTool[] {
	return tools.map((tool) => ({
		type: "function" as const,
		function: {
			name: tool.name,
			description: tool.description,
			parameters: tool.inputSchema as OpenAI.FunctionParameters,
		},
	}));
}

/**
 * Build tool params for OpenAI request
 */
export function getOpenAIToolParams(
	tools?: Array<{ name: string; description: string; inputSchema: unknown }>,
): {
	tools?: OpenAI.Chat.ChatCompletionTool[];
	tool_choice?: OpenAI.Chat.ChatCompletionToolChoiceOption;
} {
	if (!tools || tools.length === 0) {
		return {};
	}

	return {
		tools: convertToolsToOpenAI(tools),
		tool_choice: "auto",
	};
}
