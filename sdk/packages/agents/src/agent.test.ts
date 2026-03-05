import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTool } from "./tools/create.js";
import type { AgentExtension, Tool } from "./types.js";

type FakeChunk = Record<string, unknown>;

type FakeHandler = {
	createMessage: ReturnType<typeof vi.fn>;
	getModel: ReturnType<typeof vi.fn>;
	getMessages: ReturnType<typeof vi.fn>;
};

const createHandlerMock = vi.fn<(config: unknown) => FakeHandler>();

vi.mock("@cline/llms", () => ({
	providers: {
		createHandler: (config: unknown) => createHandlerMock(config),
	},
}));

async function* streamChunks(chunks: FakeChunk[]): AsyncGenerator<FakeChunk> {
	for (const chunk of chunks) {
		yield chunk;
	}
}

function makeHandler(turns: FakeChunk[][]): FakeHandler {
	let index = 0;
	return {
		createMessage: vi.fn(() => {
			const chunks = turns[index] ?? [];
			index += 1;
			return streamChunks(chunks);
		}),
		getModel: vi.fn(() => ({
			id: "mock-model",
			info: {},
		})),
		getMessages: vi.fn(),
	};
}

describe("Agent", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("runs a basic single turn and returns final text", async () => {
		const { Agent } = await import("./agent.js");
		const handler = makeHandler([
			[
				{ type: "text", id: "r1", text: "Hello from model" },
				{ type: "usage", id: "r1", inputTokens: 10, outputTokens: 5 },
				{ type: "done", id: "r1", success: true },
			],
		]);
		createHandlerMock.mockReturnValue(handler);

		const events: string[] = [];
		const agent = new Agent({
			providerId: "anthropic",
			modelId: "mock-model",
			systemPrompt: "You are helpful.",
			tools: [],
			onEvent: (event) => events.push(event.type),
		});

		const result = await agent.run("Say hello");

		expect(result.finishReason).toBe("completed");
		expect(result.text).toBe("Hello from model");
		expect(result.iterations).toBe(1);
		expect(result.usage.inputTokens).toBe(10);
		expect(result.usage.outputTokens).toBe(5);
		expect(events).toContain("done");
	});

	it("executes tool calls and applies tool policy approval", async () => {
		const { Agent } = await import("./agent.js");
		const mathTool: Tool<{ a: number; b: number }, { total: number }> =
			createTool({
				name: "math_add",
				description: "Add two numbers",
				inputSchema: {
					type: "object",
					properties: {
						a: { type: "number" },
						b: { type: "number" },
					},
					required: ["a", "b"],
				},
				execute: async ({ a, b }) => ({ total: a + b }),
			});
		const genericMathTool = mathTool as Tool;

		const handler = makeHandler([
			[
				{
					type: "tool_calls",
					id: "r1",
					tool_call: {
						call_id: "call_1",
						function: {
							name: "math_add",
							arguments: JSON.stringify({ a: 2, b: 3 }),
						},
					},
				},
				{ type: "usage", id: "r1", inputTokens: 20, outputTokens: 8 },
				{ type: "done", id: "r1", success: true },
			],
			[
				{ type: "text", id: "r2", text: "Done" },
				{ type: "usage", id: "r2", inputTokens: 12, outputTokens: 4 },
				{ type: "done", id: "r2", success: true },
			],
		]);
		createHandlerMock.mockReturnValue(handler);

		const approval = vi.fn().mockResolvedValue({ approved: true });
		const agent = new Agent({
			providerId: "anthropic",
			modelId: "mock-model",
			systemPrompt: "Use tools",
			tools: [genericMathTool],
			toolPolicies: {
				math_add: { autoApprove: false },
			},
			requestToolApproval: approval,
		});

		const result = await agent.run("compute");

		expect(approval).toHaveBeenCalledTimes(1);
		expect(result.finishReason).toBe("completed");
		expect(result.toolCalls).toHaveLength(1);
		expect(result.toolCalls[0]?.output).toEqual({ total: 5 });
		expect(result.text).toBe("Done");
	});

	it("continues conversation and clearHistory resets message state", async () => {
		const { Agent } = await import("./agent.js");
		const handler = makeHandler([
			[
				{ type: "text", id: "r1", text: "First turn" },
				{ type: "usage", id: "r1", inputTokens: 4, outputTokens: 3 },
				{ type: "done", id: "r1", success: true },
			],
			[
				{ type: "text", id: "r2", text: "Second turn" },
				{ type: "usage", id: "r2", inputTokens: 5, outputTokens: 2 },
				{ type: "done", id: "r2", success: true },
			],
		]);
		createHandlerMock.mockReturnValue(handler);

		const agent = new Agent({
			providerId: "anthropic",
			modelId: "mock-model",
			systemPrompt: "Continue support",
			tools: [],
		});

		await agent.run("one");
		const beforeContinueMessages = agent.getMessages();
		expect(beforeContinueMessages.length).toBeGreaterThanOrEqual(2);

		const second = await agent.continue("two");
		expect(second.text).toBe("Second turn");
		expect(agent.getMessages().length).toBeGreaterThan(
			beforeContinueMessages.length,
		);

		agent.clearHistory();
		expect(agent.getMessages()).toEqual([]);
	});

	it("restores preloaded messages via config and restore()", async () => {
		const { Agent } = await import("./agent.js");
		const handler = makeHandler([
			[
				{ type: "text", id: "r1", text: "restored" },
				{ type: "usage", id: "r1", inputTokens: 1, outputTokens: 1 },
				{ type: "done", id: "r1", success: true },
			],
			[
				{ type: "text", id: "r2", text: "restored-again" },
				{ type: "usage", id: "r2", inputTokens: 1, outputTokens: 1 },
				{ type: "done", id: "r2", success: true },
			],
		]);
		createHandlerMock.mockReturnValue(handler);

		const initial = [
			{ role: "user", content: [{ type: "text", text: "history" }] },
		];
		const agent = new Agent({
			providerId: "anthropic",
			modelId: "mock-model",
			systemPrompt: "Restore support",
			tools: [],
			initialMessages: initial,
		});

		expect(agent.getMessages()).toEqual(initial);
		const first = await agent.continue("resume");
		expect(first.text).toBe("restored");

		const restored = [
			{ role: "assistant", content: [{ type: "text", text: "new-state" }] },
		];
		agent.restore(restored);
		expect(agent.getMessages()).toEqual(restored);
		const second = await agent.continue("resume-2");
		expect(second.text).toBe("restored-again");
	});

	it("supports shutdown hooks and early run cancellation via hook control", async () => {
		const { Agent } = await import("./agent.js");
		const handler = makeHandler([
			[
				{ type: "text", id: "r1", text: "Should not run" },
				{ type: "usage", id: "r1", inputTokens: 1, outputTokens: 1 },
				{ type: "done", id: "r1", success: true },
			],
		]);
		createHandlerMock.mockReturnValue(handler);

		const onSessionShutdown = vi.fn().mockResolvedValue(undefined);

		const agent = new Agent({
			providerId: "anthropic",
			modelId: "mock-model",
			systemPrompt: "cancel fast",
			tools: [],
			hooks: {
				onRunStart: () => ({ cancel: true }),
				onSessionShutdown,
			},
		});

		const result = await agent.run("cancel this");
		expect(result.finishReason).toBe("aborted");
		expect(result.iterations).toBe(0);
		expect(handler.createMessage).not.toHaveBeenCalled();

		await agent.shutdown("test-end");
		expect(onSessionShutdown).toHaveBeenCalledTimes(1);
	});

	it("dispatches onRuntimeEvent through HookEngine extension stage", async () => {
		const { Agent } = await import("./agent.js");
		const handler = makeHandler([
			[
				{ type: "text", id: "r1", text: "ok" },
				{ type: "usage", id: "r1", inputTokens: 1, outputTokens: 1 },
				{ type: "done", id: "r1", success: true },
			],
		]);
		createHandlerMock.mockReturnValue(handler);

		const onRuntimeEvent = vi.fn().mockResolvedValue(undefined);
		const extension: AgentExtension = {
			name: "runtime-ext",
			onRuntimeEvent,
		};

		const agent = new Agent({
			providerId: "anthropic",
			modelId: "mock-model",
			systemPrompt: "runtime events",
			tools: [],
			extensions: [extension],
		});

		await agent.run("trigger");

		expect(onRuntimeEvent).toHaveBeenCalled();
		expect(
			onRuntimeEvent.mock.calls.some((args) => args[0]?.event?.type === "done"),
		).toBe(true);
	});

	it("adds image blocks to initial user content when provided", async () => {
		const { Agent } = await import("./agent.js");
		const handler = makeHandler([
			[
				{ type: "text", id: "r1", text: "ok" },
				{ type: "usage", id: "r1", inputTokens: 1, outputTokens: 1 },
				{ type: "done", id: "r1", success: true },
			],
		]);
		createHandlerMock.mockReturnValue(handler);

		const agent = new Agent({
			providerId: "anthropic",
			modelId: "mock-model",
			systemPrompt: "You are helpful.",
			tools: [],
		});

		await agent.run("Analyze this image", ["data:image/png;base64,aGVsbG8="]);

		expect(handler.createMessage).toHaveBeenCalledTimes(1);
		const requestMessages = handler.createMessage.mock.calls[0]?.[1] as Array<{
			role: string;
			content: unknown;
		}>;
		expect(requestMessages[0]?.role).toBe("user");
		expect(requestMessages[0]?.content).toEqual([
			{ type: "text", text: "Analyze this image" },
			{ type: "image", mediaType: "image/png", data: "aGVsbG8=" },
		]);
	});

	it("adds attached file content text block to initial user content", async () => {
		const { Agent } = await import("./agent.js");
		const handler = makeHandler([
			[
				{ type: "text", id: "r1", text: "ok" },
				{ type: "usage", id: "r1", inputTokens: 1, outputTokens: 1 },
				{ type: "done", id: "r1", success: true },
			],
		]);
		createHandlerMock.mockReturnValue(handler);

		const tempDir = await mkdtemp(join(tmpdir(), "agents-run-files-"));
		const filePath = join(tempDir, "note.txt");
		try {
			await writeFile(filePath, "hello from file", "utf8");
			const agent = new Agent({
				providerId: "anthropic",
				modelId: "mock-model",
				systemPrompt: "You are helpful.",
				tools: [],
			});

			await agent.run("Use this file", undefined, [filePath]);

			expect(handler.createMessage).toHaveBeenCalledTimes(1);
			const requestMessages = handler.createMessage.mock
				.calls[0]?.[1] as Array<{
				role: string;
				content: unknown;
			}>;
			expect(requestMessages[0]?.role).toBe("user");
			expect(requestMessages[0]?.content).toEqual([
				{ type: "text", text: "Use this file" },
				{
					type: "text",
					text: `Files attached by the user:\n\n<file_content path="${filePath.replace(/\\/g, "/")}">\nhello from file\n</file_content>`,
				},
			]);
		} finally {
			await rm(tempDir, { recursive: true, force: true });
		}
	});
});
