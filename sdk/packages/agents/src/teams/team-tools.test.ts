import { resolveTeamDataDir } from "@cline/shared/storage";
import { afterEach, describe, expect, it } from "vitest";
import { AgentTeamsRuntime } from "./multi-agent";
import { createAgentTeamsTools } from "./team-tools";

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
		const teamLogUpdate = tools.find((tool) => tool.name === "team_log_update");

		expect(teamTask?.inputSchema.type).toBe("object");
		expect(teamMessage?.inputSchema.type).toBe("object");
		expect(teamMember?.inputSchema.type).toBe("object");
		expect(teamAwaitRun?.inputSchema.type).toBe("object");
		const schema = teamLogUpdate?.inputSchema as
			| { properties: Record<string, unknown>; required: unknown[] }
			| undefined;
		expect(schema?.properties.kind).toEqual({
			type: "string",
			enum: ["progress", "handoff", "blocked", "decision", "done", "error"],
		});
		expect(schema?.required).toEqual(["kind", "summary"]);
	});

	it("returns actionable spawn validation guidance when rolePrompt is missing", async () => {
		const runtime = new AgentTeamsRuntime({ teamName: "test-team" });
		const tools = createAgentTeamsTools({
			runtime,
			requesterId: "lead",
			teammateRuntime: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-5-20250929",
			},
		});
		const teamMember = tools.find((tool) => tool.name === "team_member");
		expect(teamMember).toBeDefined();

		await expect(
			teamMember?.execute(
				{
					action: "spawn",
					agentId: "python-poet",
				},
				{
					agentId: "lead",
					conversationId: "conv-1",
					iteration: 1,
				},
			),
		).rejects.toThrow(
			'action=spawn requires non-empty "agentId" and "rolePrompt"',
		);
	});

	it("returns actionable guidance when action is missing", async () => {
		const runtime = new AgentTeamsRuntime({ teamName: "test-team" });
		const tools = createAgentTeamsTools({
			runtime,
			requesterId: "lead",
			teammateRuntime: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-5-20250929",
			},
		});
		const teamMember = tools.find((tool) => tool.name === "team_member");
		expect(teamMember).toBeDefined();

		await expect(
			teamMember?.execute(
				{
					agentId: "python-poet",
				},
				{
					agentId: "lead",
					conversationId: "conv-1",
					iteration: 1,
				},
			),
		).rejects.toThrow('team_member requires "action" (spawn|shutdown)');
	});

	it("accepts strict-mode nulls for optional team_member spawn fields", async () => {
		const runtime = new AgentTeamsRuntime({ teamName: "test-team" });
		const tools = createAgentTeamsTools({
			runtime,
			requesterId: "lead",
			teammateRuntime: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-5-20250929",
			},
		});
		const teamMember = tools.find((tool) => tool.name === "team_member");
		expect(teamMember).toBeDefined();

		await expect(
			teamMember?.execute(
				{
					action: "spawn",
					agentId: "python-poet",
					rolePrompt: "Write concise Python-focused haiku",
					maxIterations: null,
					reason: null,
				},
				{
					agentId: "lead",
					conversationId: "conv-1",
					iteration: 1,
				},
			),
		).resolves.toMatchObject({
			agentId: "python-poet",
			status: "spawned",
		});
	});
});
