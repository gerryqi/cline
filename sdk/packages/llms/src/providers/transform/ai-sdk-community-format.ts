import { formatFileContentBlock } from "@clinebot/shared";
import type { Message } from "../types/messages";
import {
	normalizeToolUseInput,
	serializeToolResultContent,
} from "./content-format";

export type AiSdkMessagePart = Record<string, unknown>;
export type AiSdkMessage = {
	role: "system" | "user" | "assistant" | "tool";
	content: string | AiSdkMessagePart[];
};

export function toAiSdkMessages(
	systemContent: string | AiSdkMessagePart[],
	messages: Message[],
	options?: { assistantToolCallArgKey?: "args" | "input" },
): AiSdkMessage[] {
	const toolCallArgKey = options?.assistantToolCallArgKey ?? "args";
	const result: AiSdkMessage[] = [{ role: "system", content: systemContent }];
	const toolNamesById = new Map<string, string>();

	for (const message of messages) {
		if (typeof message.content === "string") {
			result.push({ role: message.role, content: message.content });
			continue;
		}

		if (message.role === "assistant") {
			const parts: AiSdkMessagePart[] = [];
			for (const block of message.content) {
				if (block.type === "text") {
					parts.push({ type: "text", text: block.text });
					continue;
				}

				if (block.type === "file") {
					parts.push({
						type: "text",
						text: formatFileContentBlock(block.path, block.content),
					});
					continue;
				}

				if (block.type === "tool_use") {
					toolNamesById.set(block.id, block.name);
					parts.push({
						type: "tool-call",
						toolCallId: block.id,
						toolName: block.name,
						[toolCallArgKey]: normalizeToolUseInput(block.input),
					});
				}
			}

			if (parts.length > 0) {
				result.push({ role: "assistant", content: parts });
			}
			continue;
		}

		const userParts: AiSdkMessagePart[] = [];
		for (const block of message.content) {
			if (block.type === "text") {
				userParts.push({ type: "text", text: block.text });
				continue;
			}

			if (block.type === "file") {
				userParts.push({
					type: "text",
					text: formatFileContentBlock(block.path, block.content),
				});
				continue;
			}

			if (block.type === "image") {
				userParts.push({
					type: "image",
					image: Buffer.from(block.data, "base64"),
					mediaType: block.mediaType,
				});
				continue;
			}

			if (block.type === "tool_result") {
				if (userParts.length > 0) {
					result.push({
						role: "user",
						content: userParts.splice(0, userParts.length),
					});
				}

				result.push({
					role: "tool",
					content: [
						{
							type: "tool-result",
							toolCallId: block.tool_use_id,
							toolName: toolNamesById.get(block.tool_use_id) ?? "tool",
							output: serializeToolResultContent(block.content),
							isError: block.is_error ?? false,
						},
					],
				});
			}
		}

		if (userParts.length > 0) {
			result.push({ role: "user", content: userParts });
		}
	}

	return result;
}
