import { afterAll, beforeAll, expect, test } from "bun:test";
import { type ChildProcess, spawn } from "node:child_process";
import { join } from "node:path";

type ReadyLine = {
	type?: string;
	wsEndpoint?: string;
};

let hostProcess: ChildProcess | null = null;
let wsEndpoint = "";

function waitForReady(): Promise<string> {
	return new Promise((resolve, reject) => {
		if (!hostProcess) {
			reject(new Error("host process not started"));
			return;
		}

		let stderr = "";
		const timer = setTimeout(() => {
			reject(
				new Error(
					`timed out waiting for desktop host readiness${stderr ? `: ${stderr}` : ""}`,
				),
			);
		}, 30000);

		hostProcess.stdout?.on("data", (chunk) => {
			for (const line of String(chunk).split("\n")) {
				const trimmed = line.trim();
				if (!trimmed) {
					continue;
				}
				let parsed: ReadyLine;
				try {
					parsed = JSON.parse(trimmed) as ReadyLine;
				} catch {
					continue;
				}
				if (parsed.type === "ready" && typeof parsed.wsEndpoint === "string") {
					clearTimeout(timer);
					resolve(parsed.wsEndpoint);
					return;
				}
			}
		});

		hostProcess.stderr?.on("data", (chunk) => {
			stderr += String(chunk).trim();
		});

		hostProcess.on("exit", (code) => {
			clearTimeout(timer);
			reject(new Error(`desktop host exited before ready with code ${code}`));
		});
	});
}

function sendCommand<T>(
	command: string,
	args?: Record<string, unknown>,
): Promise<T> {
	return new Promise((resolve, reject) => {
		const socket = new WebSocket(wsEndpoint);
		const timer = setTimeout(() => {
			socket.close();
			reject(new Error(`timed out waiting for ${command}`));
		}, 15000);
		socket.onopen = () => {
			socket.send(
				JSON.stringify({
					type: "command",
					id: "test-command",
					command,
					args,
				}),
			);
		};
		socket.onmessage = (event) => {
			const parsed = JSON.parse(String(event.data)) as {
				type?: string;
				id?: string;
				ok?: boolean;
				result?: T;
				error?: string;
			};
			if (parsed.type !== "response" || parsed.id !== "test-command") {
				return;
			}
			clearTimeout(timer);
			socket.close();
			if (!parsed.ok) {
				reject(new Error(parsed.error || `${command} failed`));
				return;
			}
			resolve(parsed.result as T);
		};
		socket.onerror = () => {
			clearTimeout(timer);
			reject(new Error(`websocket error during ${command}`));
		};
	});
}

beforeAll(async () => {
	hostProcess = spawn("bun", ["run", "host/index.ts"], {
		cwd: join(import.meta.dir, ".."),
		stdio: ["ignore", "pipe", "pipe"],
		env: {
			...process.env,
			CLINE_CODE_HOST_SKIP_RPC_BOOTSTRAP: "1",
		},
	});
	wsEndpoint = await waitForReady();
}, 30000);

afterAll(() => {
	hostProcess?.kill("SIGTERM");
	hostProcess = null;
});

test("desktop host serves process context over websocket transport", async () => {
	const context = await sendCommand<{ workspaceRoot: string; cwd: string }>(
		"get_process_context",
	);
	expect(context.workspaceRoot.length).toBeGreaterThan(0);
	expect(context.cwd.length).toBeGreaterThan(0);
}, 30000);

test("desktop host serves provider catalog over websocket transport", async () => {
	const catalog = await sendCommand<{ providers?: Array<{ id?: string }> }>(
		"list_provider_catalog",
	);
	expect(Array.isArray(catalog.providers)).toBeTrue();
}, 30000);
