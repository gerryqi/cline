import { describe, expect, it, vi } from "vitest";

const createBuiltinToolsMock = vi.fn(() => []);
const bootstrapAgentTeamsMock = vi.fn(() => ({
	tools: [],
	restoredFromPersistence: true,
	restoredTeammates: ["restored-1"],
}));

let runtimeInstance: MockAgentTeamsRuntime | undefined;
class MockAgentTeamsRuntime {
	private readonly onTeamEvent?: (event: any) => void;

	constructor(options: { onTeamEvent?: (event: any) => void }) {
		this.onTeamEvent = options.onTeamEvent;
		runtimeInstance = this;
	}

	emit(event: any): void {
		this.onTeamEvent?.(event);
	}

	hydrateState = vi.fn();
	exportState = vi.fn(() => ({
		members: [],
		tasks: [],
		mailbox: [],
		missionLog: [],
	}));
	getTeammateIds = vi.fn(() => []);
	shutdownTeammate = vi.fn();
}

vi.mock("@cline/agents", () => ({
	AgentTeamsRuntime: MockAgentTeamsRuntime,
	bootstrapAgentTeams: bootstrapAgentTeamsMock,
}));

vi.mock("../default-tools", () => ({
	ALL_DEFAULT_TOOL_NAMES: [],
	createBuiltinTools: createBuiltinToolsMock,
	ToolPresets: {
		development: {},
		readonly: {},
	},
}));

let persistenceInstance: MockFileTeamPersistenceStore | undefined;
class MockFileTeamPersistenceStore {
	constructor() {
		persistenceInstance = this;
	}

	loadState = vi.fn(() => ({
		members: [],
		tasks: [],
		mailbox: [],
		missionLog: [],
	}));
	getTeammateSpecs = vi.fn(() => [
		{
			agentId: "restored-1",
			rolePrompt: "Persisted teammate",
			modelId: "claude-sonnet-4-5-20250929",
			maxIterations: 4,
		},
	]);
	upsertTeammateSpec = vi.fn();
	removeTeammateSpec = vi.fn();
	appendTaskHistory = vi.fn();
	persist = vi.fn();
}

vi.mock("../session/session-service", () => ({
	FileTeamPersistenceStore: MockFileTeamPersistenceStore,
}));

describe("DefaultRuntimeBuilder team persistence boundary", () => {
	it("persists teammate specs and runtime state from team events", async () => {
		const { DefaultRuntimeBuilder } = await import("./runtime-builder");
		const onTeamRestored = vi.fn();

		new DefaultRuntimeBuilder().build({
			config: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-6",
				apiKey: "key",
				systemPrompt: "test",
				cwd: process.cwd(),
				enableTools: false,
				enableSpawnAgent: false,
				enableAgentTeams: true,
			},
			onTeamRestored,
		});

		expect(bootstrapAgentTeamsMock).toHaveBeenCalledWith(
			expect.objectContaining({
				restoredFromPersistence: true,
				restoredTeammates: [expect.objectContaining({ agentId: "restored-1" })],
			}),
		);
		expect(onTeamRestored).toHaveBeenCalledTimes(1);
		expect(runtimeInstance).toBeDefined();
		expect(persistenceInstance).toBeDefined();
		if (!runtimeInstance || !persistenceInstance) {
			throw new Error("Expected mocked runtime and persistence instances");
		}

		runtimeInstance.emit({
			type: "teammate_spawned",
			agentId: "python-poet",
			teammate: {
				rolePrompt: "Write concise Python-focused haiku",
				modelId: "claude-sonnet-4-5-20250929",
				maxIterations: 7,
			},
		});
		expect(persistenceInstance.upsertTeammateSpec).toHaveBeenCalledWith({
			agentId: "python-poet",
			rolePrompt: "Write concise Python-focused haiku",
			modelId: "claude-sonnet-4-5-20250929",
			maxIterations: 7,
		});
		expect(persistenceInstance.appendTaskHistory).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "teammate_spawned",
				agentId: "python-poet",
			}),
		);
		expect(persistenceInstance.persist).toHaveBeenCalled();

		runtimeInstance.emit({
			type: "teammate_shutdown",
			agentId: "python-poet",
		});
		expect(persistenceInstance.removeTeammateSpec).toHaveBeenCalledWith(
			"python-poet",
		);
		expect(persistenceInstance.appendTaskHistory).toHaveBeenCalledWith(
			expect.objectContaining({
				type: "teammate_shutdown",
				agentId: "python-poet",
			}),
		);
	});
});
