import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSubprocessHooks, runHook } from "./hooks.js";

const tmpPaths: string[] = [];

afterEach(async () => {
	for (const path of tmpPaths) {
		await rm(path, { recursive: true, force: true });
	}
	tmpPaths.length = 0;
});

describe("hooks", () => {
	it("runHook pipes payload to command and parses JSON stdout", async () => {
		const result = await runHook(
			{
				hook_event_name: "tool_call",
				agent_id: "agent-1",
				conversation_id: "conv-1",
				parent_agent_id: null,
				iteration: 1,
				tool_call: {
					id: "call-1",
					name: "read_file",
					input: { path: "README.md" },
				},
			},
			{
				command: [
					process.execPath,
					"-e",
					"let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const p=JSON.parse(d);process.stdout.write(JSON.stringify({cancel:p.hook_event_name==='tool_call',context:'ok'}));});",
				],
			},
		);

		expect(result?.exitCode).toBe(0);
		expect(result?.parsedJson).toEqual({ cancel: true, context: "ok" });
	});

	it("createSubprocessHooks maps lifecycle payloads and returns hook controls", async () => {
		const dir = await mkdtemp(join(tmpdir(), "agents-hooks-"));
		tmpPaths.push(dir);
		const output = join(dir, "events.log");

		const script =
			"const fs=require('node:fs');let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const p=JSON.parse(d);fs.appendFileSync(process.argv[1],JSON.stringify(p)+'\\n');if(p.hook_event_name==='tool_call'){process.stdout.write(JSON.stringify({cancel:true,context:'stop-now',overrideInput:{safe:true}}));}});";

		const hookControl = createSubprocessHooks({
			command: [process.execPath, "-e", script, output],
		});

		const control = await hookControl.hooks.onToolCallStart?.({
			agentId: "agent-main",
			conversationId: "conv-main",
			parentAgentId: null,
			iteration: 2,
			call: {
				id: "c-1",
				name: "bash",
				input: { command: "ls" },
			},
		});
		expect(control).toEqual({
			cancel: true,
			context: "stop-now",
			overrideInput: { safe: true },
		});

		await expect(
			hookControl.hooks.onToolCallEnd?.({
				agentId: "agent-main",
				conversationId: "conv-main",
				parentAgentId: null,
				iteration: 2,
				record: {
					id: "c-1",
					name: "bash",
					input: { command: "ls" },
					output: "ok",
					durationMs: 1,
					startedAt: new Date(),
					endedAt: new Date(),
				},
			}),
		).resolves.toBeUndefined();
		await expect(
			hookControl.hooks.onTurnEnd?.({
				agentId: "agent-main",
				conversationId: "conv-main",
				parentAgentId: null,
				iteration: 2,
				turn: {
					text: "done",
					toolCalls: [],
					usage: { inputTokens: 1, outputTokens: 1 },
					truncated: false,
				},
			}),
		).resolves.toBeUndefined();
		await expect(
			hookControl.shutdown({
				agentId: "agent-main",
				conversationId: "conv-main",
				parentAgentId: null,
				reason: "test",
			}),
		).resolves.toBeUndefined();

		await new Promise((resolve) => setTimeout(resolve, 80));
		const lines = (await readFile(output, "utf8"))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));

		expect(lines.some((e) => e.hook_event_name === "tool_call")).toBe(true);
	});

	it("reports dispatch errors without throwing", async () => {
		const onDispatchError = vi
			.fn<(error: Error) => void>()
			.mockImplementation(() => undefined);

		const hookControl = createSubprocessHooks({
			command: ["/path/does/not/exist"],
			onDispatchError: (error) => onDispatchError(error),
		});

		await expect(
			hookControl.hooks.onToolCallEnd?.({
				agentId: "agent-main",
				conversationId: "conv-main",
				parentAgentId: null,
				iteration: 2,
				record: {
					id: "c-1",
					name: "bash",
					input: { command: "ls" },
					output: "ok",
					durationMs: 1,
					startedAt: new Date(),
					endedAt: new Date(),
				},
			}),
		).resolves.toBeUndefined();

		await new Promise((resolve) => setTimeout(resolve, 30));
		expect(onDispatchError).toHaveBeenCalled();
	});
});
