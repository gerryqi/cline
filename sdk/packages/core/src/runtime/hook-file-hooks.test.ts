import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createHookConfigFileHooks } from "./hook-file-hooks";

async function createWorkspaceWithHook(
	fileName: string,
	body: string,
): Promise<{ workspace: string; hookPath: string }> {
	const workspace = await mkdtemp(join(tmpdir(), "hooks-workspace-"));
	const hooksDir = join(workspace, ".clinerules", "hooks");
	await mkdir(hooksDir, { recursive: true });
	const hookPath = join(hooksDir, fileName);
	await writeFile(hookPath, body, "utf8");
	return { workspace, hookPath };
}

describe("createHookConfigFileHooks", () => {
	it("executes extensionless legacy hook files via bash fallback", async () => {
		const { workspace } = await createWorkspaceWithHook(
			"PreToolUse",
			'echo \'HOOK_CONTROL\t{"cancel":true,"context":"legacy-ok"}\'\n',
		);
		try {
			const hooks = createHookConfigFileHooks({
				cwd: workspace,
				workspacePath: workspace,
			});
			expect(hooks?.onToolCallStart).toBeTypeOf("function");
			const control = await hooks?.onToolCallStart?.({
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
			expect(control).toMatchObject({ cancel: true, context: "legacy-ok" });
		} finally {
			await rm(workspace, { recursive: true, force: true });
		}
	});

	it("honors shebang interpreter when present", async () => {
		const { workspace } = await createWorkspaceWithHook(
			"PreToolUse",
			'#!/usr/bin/env bash\necho \'HOOK_CONTROL\t{"cancel":false,"context":"shebang-ok"}\'\n',
		);
		try {
			const hooks = createHookConfigFileHooks({
				cwd: workspace,
				workspacePath: workspace,
			});
			expect(hooks?.onToolCallStart).toBeTypeOf("function");
			const control = await hooks?.onToolCallStart?.({
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
			expect(control).toMatchObject({ cancel: false, context: "shebang-ok" });
		} finally {
			await rm(workspace, { recursive: true, force: true });
		}
	});

	it("parses review control from hook output", async () => {
		const { workspace } = await createWorkspaceWithHook(
			"PreToolUse.ts",
			'console.log(\'HOOK_CONTROL\\t{"review":true,"context":"needs-review"}\')\n',
		);
		try {
			const hooks = createHookConfigFileHooks({
				cwd: workspace,
				workspacePath: workspace,
			});
			expect(hooks?.onToolCallStart).toBeTypeOf("function");
			const control = await hooks?.onToolCallStart?.({
				agentId: "agent_1",
				conversationId: "conv_1",
				parentAgentId: null,
				iteration: 1,
				call: {
					id: "call_1",
					name: "run_commands",
					input: { commands: ["git status"] },
				},
			});
			expect(control).toMatchObject({
				review: true,
				context: "needs-review",
			});
		} finally {
			await rm(workspace, { recursive: true, force: true });
		}
	});
});
