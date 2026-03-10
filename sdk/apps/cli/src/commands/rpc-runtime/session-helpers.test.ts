import { describe, expect, it, vi } from "vitest";

vi.mock("../../runtime/prompt", () => ({
	resolveSystemPrompt: vi.fn(async () => "resolved system prompt"),
}));

vi.mock("../../logging/adapter", () => ({
	createCliLoggerAdapter: vi.fn(() => ({
		core: {
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
		},
	})),
}));

describe("buildSessionStartInput", () => {
	it("keeps maxIterations unset when not provided", async () => {
		const { buildSessionStartInput } = await import("./session-helpers");
		const built = await buildSessionStartInput({
			config: {
				provider: "cline",
				model: "anthropic/claude-sonnet-4.6",
				workspaceRoot: process.cwd(),
				cwd: process.cwd(),
				enableTools: true,
				enableSpawn: true,
				enableTeams: true,
				autoApproveTools: true,
			} as any,
		});

		expect(built.sessionInput.config.maxIterations).toBeUndefined();
	});
});

describe("rpc-runtime payload parsing", () => {
	it("normalizes null maxIterations in start payload to undefined", async () => {
		const { parseStartPayload } = await import("./session-helpers");
		const parsed = parseStartPayload(
			JSON.stringify({
				provider: "cline",
				model: "anthropic/claude-sonnet-4.6",
				workspaceRoot: process.cwd(),
				cwd: process.cwd(),
				enableTools: true,
				enableSpawn: false,
				enableTeams: false,
				autoApproveTools: true,
				maxIterations: null,
			}),
		);
		expect(parsed.maxIterations).toBeUndefined();
	});

	it("normalizes null maxIterations in send payload config to undefined", async () => {
		const { parseSendPayload } = await import("./session-helpers");
		const parsed = parseSendPayload(
			JSON.stringify({
				prompt: "hey",
				config: {
					provider: "cline",
					model: "anthropic/claude-sonnet-4.6",
					workspaceRoot: process.cwd(),
					cwd: process.cwd(),
					enableTools: true,
					enableSpawn: false,
					enableTeams: false,
					autoApproveTools: true,
					maxIterations: null,
				},
			}),
		);
		expect(parsed.config.maxIterations).toBeUndefined();
	});
});
