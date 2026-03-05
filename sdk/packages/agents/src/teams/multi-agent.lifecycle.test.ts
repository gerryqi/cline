import { describe, expect, it, vi } from "vitest";
import {
	AgentTeamsRuntime,
	type TeamEvent,
	TeamMessageType,
} from "./multi-agent";

vi.mock("../agent.js", () => ({
	createAgent: vi.fn(() => ({
		abort: vi.fn(),
		run: vi.fn(),
		continue: vi.fn(),
		getAgentId: vi.fn(() => "teammate-1"),
		getConversationId: vi.fn(() => "conv-1"),
	})),
}));

describe("AgentTeamsRuntime teammate lifecycle events", () => {
	it("emits teammate_spawned with lifecycle payload", () => {
		const events: TeamEvent[] = [];
		const runtime = new AgentTeamsRuntime({
			teamName: "test-team",
			onTeamEvent: (event) => events.push(event),
		});

		runtime.spawnTeammate({
			agentId: "python-poet",
			config: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-5-20250929",
				systemPrompt: "Write concise Python-focused haiku",
				maxIterations: 7,
				tools: [],
			},
		});

		expect(events).toContainEqual({
			type: TeamMessageType.TeammateSpawned,
			agentId: "python-poet",
			role: undefined,
			teammate: {
				rolePrompt: "Write concise Python-focused haiku",
				modelId: "claude-sonnet-4-5-20250929",
				maxIterations: 7,
			},
		});
	});
});
