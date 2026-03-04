import { afterEach, describe, expect, it } from "vitest";
import { AgentTeamsRuntime } from "./multi-agent";
import { createAgentTeamsTools, resolveTeamDataDir } from "./team-tools";

type EnvSnapshot = {
	CLINE_DATA_DIR: string | undefined;
	CLINE_TEAM_DATA_DIR: string | undefined;
};

function captureEnv(): EnvSnapshot {
	return {
		CLINE_DATA_DIR: process.env.CLINE_DATA_DIR,
		CLINE_TEAM_DATA_DIR: process.env.CLINE_TEAM_DATA_DIR,
	};
}

function restoreEnv(snapshot: EnvSnapshot): void {
	process.env.CLINE_DATA_DIR = snapshot.CLINE_DATA_DIR;
	process.env.CLINE_TEAM_DATA_DIR = snapshot.CLINE_TEAM_DATA_DIR;
}

describe("resolveTeamDataDir", () => {
	let snapshot: EnvSnapshot = captureEnv();

	afterEach(() => {
		restoreEnv(snapshot);
	});

	it("uses CLINE_TEAM_DATA_DIR when set", () => {
		snapshot = captureEnv();
		process.env.CLINE_TEAM_DATA_DIR = "/tmp/team-dir";
		process.env.CLINE_DATA_DIR = "/tmp/cline-data";
		expect(resolveTeamDataDir()).toBe("/tmp/team-dir");
	});

	it("falls back to CLINE_DATA_DIR/teams", () => {
		snapshot = captureEnv();
		delete process.env.CLINE_TEAM_DATA_DIR;
		process.env.CLINE_DATA_DIR = "/tmp/cline-data";
		expect(resolveTeamDataDir()).toBe("/tmp/cline-data/teams");
	});
});

describe("createAgentTeamsTools schema surface", () => {
	it("exposes object properties for grouped team tools", () => {
		const runtime = new AgentTeamsRuntime({ teamName: "test-team" });
		const tools = createAgentTeamsTools({
			runtime,
			requesterId: "lead",
			teammateRuntime: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-5-20250929",
			},
		});

		const teamTask = tools.find((tool) => tool.name === "team_task");
		const teamMessage = tools.find((tool) => tool.name === "team_message");
		const teamMember = tools.find((tool) => tool.name === "team_member");
		const teamAwaitRun = tools.find((tool) => tool.name === "team_await_run");

		expect(teamTask?.inputSchema.properties?.action).toBeDefined();
		expect(teamMessage?.inputSchema.properties?.action).toBeDefined();
		expect(teamMember?.inputSchema.properties?.action).toBeDefined();
		expect(teamAwaitRun?.inputSchema.properties?.runId).toBeDefined();
	});
});
