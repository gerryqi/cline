import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runHookMock = vi.fn();
const listHookConfigFilesMock = vi.fn();

vi.mock("@cline/agents", () => ({
	runHook: (...args: unknown[]) => runHookMock(...args),
}));

vi.mock("../agents/hooks-config-loader", async () => {
	return {
		listHookConfigFiles: (...args: unknown[]) =>
			listHookConfigFilesMock(...args),
	};
});

describe("createHookConfigFileHooks", () => {
	beforeEach(() => {
		runHookMock.mockReset();
		listHookConfigFilesMock.mockReset();
		runHookMock.mockResolvedValue({});
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("uses bash interpreter fallback for legacy hook files without shebang", async () => {
		const { createHookConfigFileHooks } = await import("./hook-file-hooks");
		const tempDir = await mkdtemp(join(tmpdir(), "hooks-fallback-"));
		const hookPath = join(tempDir, "TaskComplete");
		await writeFile(hookPath, "echo done\n", "utf8");
		listHookConfigFilesMock.mockReturnValue([
			{
				fileName: "TaskComplete",
				hookEventName: "agent_end",
				path: hookPath,
			},
		]);

		try {
			const hooks = createHookConfigFileHooks({
				cwd: tempDir,
				workspacePath: tempDir,
			});
			expect(hooks?.onTurnEnd).toBeTypeOf("function");
			await hooks?.onTurnEnd?.({
				agentId: "agent_1",
				conversationId: "conv_1",
				parentAgentId: null,
				iteration: 1,
				turn: {
					text: "done",
					toolCalls: [],
					usage: { inputTokens: 1, outputTokens: 1 },
					truncated: false,
				},
			});

			expect(runHookMock).toHaveBeenCalledTimes(1);
			expect(runHookMock.mock.calls[0]?.[1]?.command).toEqual([
				"/bin/bash",
				hookPath,
			]);
		} finally {
			await rm(tempDir, { recursive: true, force: true });
		}
	});

	it("uses shebang command when present", async () => {
		const { createHookConfigFileHooks } = await import("./hook-file-hooks");
		const tempDir = await mkdtemp(join(tmpdir(), "hooks-shebang-"));
		const hookPath = join(tempDir, "PreToolUse");
		await writeFile(hookPath, "#!/usr/bin/env bash\necho pretool\n", "utf8");
		listHookConfigFilesMock.mockReturnValue([
			{
				fileName: "PreToolUse",
				hookEventName: "tool_call",
				path: hookPath,
			},
		]);

		try {
			const hooks = createHookConfigFileHooks({
				cwd: tempDir,
				workspacePath: tempDir,
			});
			expect(hooks?.onToolCallStart).toBeTypeOf("function");
			await hooks?.onToolCallStart?.({
				agentId: "agent_1",
				conversationId: "conv_1",
				parentAgentId: null,
				iteration: 1,
				call: {
					id: "call_1",
					name: "read_file",
					input: { path: "README.md" },
				},
			});

			expect(runHookMock).toHaveBeenCalledTimes(1);
			expect(runHookMock.mock.calls[0]?.[1]?.command).toEqual([
				"/usr/bin/env",
				"bash",
				hookPath,
			]);
		} finally {
			await rm(tempDir, { recursive: true, force: true });
		}
	});
});
