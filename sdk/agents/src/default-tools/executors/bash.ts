/**
 * Bash Executor
 *
 * Built-in implementation for running shell commands using Node.js spawn.
 */

import { spawn } from "node:child_process";
import type { ToolContext } from "../../types.js";
import type { BashExecutor } from "../types.js";

/**
 * Options for the bash executor
 */
export interface BashExecutorOptions {
	/**
	 * Shell to use for execution
	 * @default "/bin/bash" on Unix, "cmd.exe" on Windows
	 */
	shell?: string;

	/**
	 * Timeout for command execution in milliseconds
	 * @default 30000 (30 seconds)
	 */
	timeoutMs?: number;

	/**
	 * Maximum output size in bytes
	 * @default 1_000_000 (1MB)
	 */
	maxOutputBytes?: number;

	/**
	 * Environment variables to add/override
	 */
	env?: Record<string, string>;

	/**
	 * Whether to combine stdout and stderr
	 * @default true
	 */
	combineOutput?: boolean;
}

/**
 * Create a bash executor using Node.js spawn
 *
 * @example
 * ```typescript
 * const bash = createBashExecutor({
 *   timeoutMs: 60000, // 1 minute timeout
 *   shell: "/bin/zsh",
 * })
 *
 * const output = await bash("ls -la", "/path/to/project", context)
 * ```
 */
export function createBashExecutor(
	options: BashExecutorOptions = {},
): BashExecutor {
	const {
		shell = process.platform === "win32" ? "cmd.exe" : "/bin/bash",
		timeoutMs = 30000,
		maxOutputBytes = 1_000_000,
		env = {},
		combineOutput = true,
	} = options;

	return async (
		command: string,
		cwd: string,
		context: ToolContext,
	): Promise<string> => {
		return new Promise((resolve, reject) => {
			const shellArgs =
				process.platform === "win32" ? ["/c", command] : ["-c", command];
			const isWindows = process.platform === "win32";

			const child = spawn(shell, shellArgs, {
				cwd,
				env: { ...process.env, ...env },
				stdio: ["pipe", "pipe", "pipe"],
				// On Unix, place command in its own process group so abort can kill descendants too.
				detached: !isWindows,
			});
			const childPid = child.pid;

			let stdout = "";
			let stderr = "";
			let outputSize = 0;
			let killed = false;
			let settled = false;

			const finalizeReject = (error: Error) => {
				if (settled) {
					return;
				}
				settled = true;
				reject(error);
			};

			const finalizeResolve = (output: string) => {
				if (settled) {
					return;
				}
				settled = true;
				resolve(output);
			};

			const killProcessTree = () => {
				if (!childPid) {
					return;
				}
				if (isWindows) {
					const killer = spawn(
						"taskkill",
						["/pid", String(childPid), "/T", "/F"],
						{
							stdio: "ignore",
							windowsHide: true,
						},
					);
					killer.unref();
					return;
				}
				try {
					process.kill(-childPid, "SIGKILL");
				} catch {
					child.kill("SIGKILL");
				}
			};

			// Handle timeout
			const timeout = setTimeout(() => {
				killed = true;
				killProcessTree();
				finalizeReject(new Error(`Command timed out after ${timeoutMs}ms`));
			}, timeoutMs);

			// Handle abort signal
			const abortHandler = () => {
				killed = true;
				killProcessTree();
				finalizeReject(new Error("Command was aborted"));
			};

			if (context.abortSignal) {
				context.abortSignal.addEventListener("abort", abortHandler);
			}

			// Collect stdout
			child.stdout?.on("data", (data: Buffer) => {
				outputSize += data.length;
				if (outputSize <= maxOutputBytes) {
					stdout += data.toString();
				}
			});

			// Collect stderr
			child.stderr?.on("data", (data: Buffer) => {
				outputSize += data.length;
				if (outputSize <= maxOutputBytes) {
					stderr += data.toString();
				}
			});

			// Handle completion
			child.on("close", (code) => {
				clearTimeout(timeout);
				if (context.abortSignal) {
					context.abortSignal.removeEventListener("abort", abortHandler);
				}

				if (killed) return;

				// Truncation warning
				let output = combineOutput
					? stdout + (stderr ? `\n[stderr]\n${stderr}` : "")
					: stdout;

				if (outputSize > maxOutputBytes) {
					output += `\n\n[Output truncated: ${outputSize} bytes total, showing first ${maxOutputBytes} bytes]`;
				}

				if (code !== 0) {
					const errorMsg = stderr || `Command exited with code ${code}`;
					finalizeReject(new Error(errorMsg));
				} else {
					finalizeResolve(output);
				}
			});

			// Handle spawn errors
			child.on("error", (error) => {
				clearTimeout(timeout);
				if (context.abortSignal) {
					context.abortSignal.removeEventListener("abort", abortHandler);
				}
				finalizeReject(
					new Error(`Failed to execute command: ${error.message}`),
				);
			});
		});
	};
}
