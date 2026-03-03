import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTool } from "./tools/create.js";
import type { Tool } from "./types.js";

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
});
