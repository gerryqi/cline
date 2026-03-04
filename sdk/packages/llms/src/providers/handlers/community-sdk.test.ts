import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiStreamChunk } from "../types";
import { ClaudeCodeHandler, OpenCodeHandler } from "./community-sdk";

const streamTextSpy = vi.fn();
const claudeCodeSpy = vi.fn((modelId: string) => ({ modelId }));
const opencodeSpy = vi.fn((modelId: string) => ({ modelId }));

vi.mock("ai", () => ({
	streamText: (input: unknown) => streamTextSpy(input),
}));

vi.mock("ai-sdk-provider-claude-code", () => ({
	claudeCode: (modelId: string) => claudeCodeSpy(modelId),
	createClaudeCode: () => (modelId: string) => claudeCodeSpy(modelId),
}));

vi.mock("ai-sdk-provider-opencode-sdk", () => ({
	opencode: (modelId: string) => opencodeSpy(modelId),
	createOpencode: () => (modelId: string) => opencodeSpy(modelId),
}));

async function* makeStreamParts(parts: unknown[]) {
	for (const part of parts) {
		yield part;
	}
}

describe("Community SDK handlers", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("ClaudeCodeHandler", () => {
		it("streams text and usage through AI SDK fullStream", async () => {
			streamTextSpy.mockReturnValue({
				fullStream: makeStreamParts([
					{ type: "text-delta", textDelta: "Hello" },
					{
						type: "finish",
						usage: { inputTokens: 10, outputTokens: 3 },
					},
				]),
			});

			const handler = new ClaudeCodeHandler({
				providerId: "claude-code",
				modelId: "sonnet",
			});

			const chunks: ApiStreamChunk[] = [];
			for await (const chunk of handler.createMessage("System", [
				{ role: "user", content: "Hi" },
			])) {
				chunks.push(chunk);
			}

			expect(claudeCodeSpy).toHaveBeenCalledWith("sonnet");
			expect(chunks.map((chunk) => chunk.type)).toEqual([
				"text",
				"usage",
				"done",
			]);
			const textChunk = chunks.find(
				(chunk): chunk is Extract<ApiStreamChunk, { type: "text" }> =>
					chunk.type === "text",
			);
			const usageChunk = chunks.find(
				(chunk): chunk is Extract<ApiStreamChunk, { type: "usage" }> =>
					chunk.type === "usage",
			);
			expect(textChunk?.text).toBe("Hello");
			expect(usageChunk?.inputTokens).toBe(10);
			expect(usageChunk?.outputTokens).toBe(3);
		});

		it("uses a fallback model id when model is missing", () => {
			const handler = new ClaudeCodeHandler({
				providerId: "claude-code",
				modelId: "",
			});

			expect(handler.getModel().id).toBe("sonnet");
		});
	});

	describe("OpenCodeHandler", () => {
		it("streams text and usage through AI SDK fullStream", async () => {
			streamTextSpy.mockReturnValue({
				fullStream: makeStreamParts([
					{ type: "text-delta", textDelta: "Hello" },
					{
						type: "finish",
						usage: { inputTokens: 10, outputTokens: 3 },
					},
				]),
			});

			const handler = new OpenCodeHandler({
				providerId: "opencode",
				modelId: "gpt-5.1-codex",
			});

			const chunks: ApiStreamChunk[] = [];
			for await (const chunk of handler.createMessage("System", [
				{ role: "user", content: "Hi" },
			])) {
				chunks.push(chunk);
			}

			expect(opencodeSpy).toHaveBeenCalledWith("openai/gpt-5.1-codex");
			expect(chunks.map((chunk) => chunk.type)).toEqual([
				"text",
				"usage",
				"done",
			]);
			const textChunk = chunks.find(
				(chunk): chunk is Extract<ApiStreamChunk, { type: "text" }> =>
					chunk.type === "text",
			);
			const usageChunk = chunks.find(
				(chunk): chunk is Extract<ApiStreamChunk, { type: "usage" }> =>
					chunk.type === "usage",
			);
			expect(textChunk?.text).toBe("Hello");
			expect(usageChunk?.inputTokens).toBe(10);
			expect(usageChunk?.outputTokens).toBe(3);
		});

		it("uses full model IDs without changes", async () => {
			streamTextSpy.mockReturnValue({
				fullStream: makeStreamParts([{ type: "finish", usage: {} }]),
			});

			const handler = new OpenCodeHandler({
				providerId: "opencode",
				modelId: "openai/gpt-5.1-codex-max",
			});

			for await (const _chunk of handler.createMessage("System", [
				{ role: "user", content: "Hi" },
			])) {
				// noop
			}

			expect(opencodeSpy).toHaveBeenCalledWith("openai/gpt-5.1-codex-max");
		});
	});
});
