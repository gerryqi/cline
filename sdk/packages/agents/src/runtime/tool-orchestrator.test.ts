import { describe, expect, it } from "vitest";
import type { ToolCallRecord } from "../index.js";
import { ToolOrchestrator } from "./tool-orchestrator.js";

function createOrchestrator(): ToolOrchestrator {
	return new ToolOrchestrator({
		getAgentId: () => "agent-1",
		getConversationId: () => "conversation-1",
		getParentAgentId: () => null,
		emit: () => {},
		dispatchLifecycle: async () => undefined,
		authorizeToolCall: async () => ({ allowed: true }),
	});
}

describe("ToolOrchestrator reminder cadence", () => {
	it("injects reminder only once per interval after threshold", () => {
		const orchestrator = createOrchestrator();
		const results = [
			{
				id: "tool-1",
				name: "example-tool",
				input: {},
				durationMs: 100,
				startedAt: new Date(),
				endedAt: new Date(),
				output: { ok: true },
			},
		] satisfies ToolCallRecord[];

		const at50 = orchestrator.buildToolResultMessage(results, 50, {
			afterIterations: 50,
			text: "reminder",
		});
		const at51 = orchestrator.buildToolResultMessage(results, 51, {
			afterIterations: 50,
			text: "reminder",
		});
		const at52 = orchestrator.buildToolResultMessage(results, 52, {
			afterIterations: 50,
			text: "reminder",
		});
		const at101 = orchestrator.buildToolResultMessage(results, 101, {
			afterIterations: 50,
			text: "reminder",
		});

		expect(at50.content).toHaveLength(1);
		expect(at51.content).toHaveLength(2);
		expect(at52.content).toHaveLength(1);
		expect(at101.content).toHaveLength(2);
	});
});
