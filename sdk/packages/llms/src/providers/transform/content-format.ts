import { formatFileContentBlock } from "@clinebot/shared";
import type { FileContent, ImageContent, TextContent } from "../types/messages";

export function normalizeToolUseInput(
	input: Record<string, unknown>,
): Record<string, unknown> {
	if (Array.isArray(input)) {
		return { commands: input };
	}
	return input;
}

export function serializeToolResultContent(
	content: string | Array<TextContent | ImageContent | FileContent>,
): string {
	if (typeof content === "string") {
		return content;
	}

	const parts: string[] = [];
	for (const part of content) {
		if (part.type === "text") {
			parts.push(part.text);
			continue;
		}
		if (part.type === "file") {
			parts.push(formatFileContentBlock(part.path, part.content));
			continue;
		}
		parts.push(JSON.stringify(part));
	}

	return parts.join("\n");
}
