import { spawn } from "node:child_process";

export interface RunSubprocessEventOptions {
	command: string[];
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	detached?: boolean;
	timeoutMs?: number;
}

export interface RunSubprocessEventResult {
	exitCode: number | null;
	stdout: string;
	stderr: string;
	parsedJson?: unknown;
	parseError?: string;
	timedOut?: boolean;
}

function parseStdout(stdout: string): {
	parsedJson?: unknown;
	parseError?: string;
} {
	const trimmed = stdout.trim();
	if (!trimmed) {
		return {};
	}

	const lines = trimmed
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	const prefixed = lines
		.filter((line) => line.startsWith("HOOK_CONTROL\t"))
		.map((line) => line.slice("HOOK_CONTROL\t".length));

	const candidate =
		prefixed.length > 0 ? prefixed[prefixed.length - 1] : trimmed;
	try {
		return { parsedJson: JSON.parse(candidate) };
	} catch (error) {
		return {
			parseError:
				error instanceof Error
					? error.message
					: "Failed to parse subprocess stdout JSON",
		};
	}
}

function formatSpawnError(error: unknown, command: string[]): Error {
	const err = error instanceof Error ? error : new Error(String(error));
	const withCode = err as Error & { code?: string };
	const commandLabel = command.join(" ");
	if (withCode.code === "EACCES") {
		return new Error(
			`Failed to execute hook command "${commandLabel}" (EACCES). Configure hooks with an explicit interpreter/command array (for example: ["bash", "/path/to/script"]) or make the script executable with a valid shebang.`,
		);
	}
	return new Error(
		`Failed to execute hook command "${commandLabel}": ${err.message}`,
	);
}

export async function runSubprocessEvent(
	payload: unknown,
	options: RunSubprocessEventOptions,
): Promise<RunSubprocessEventResult | undefined> {
	const command = options.command;
	if (!Array.isArray(command) || command.length === 0) {
		throw new Error("runSubprocessEvent requires a non-empty command");
	}

	const detached = !!options.detached;
	const child = spawn(command[0], command.slice(1), {
		cwd: options.cwd,
		env: options.env,
		stdio: detached ? ["pipe", "ignore", "ignore"] : ["pipe", "pipe", "pipe"],
		detached,
	});

	if (!child.stdin) {
		throw new Error("runSubprocessEvent failed to create stdin pipe");
	}
	child.stdin.write(JSON.stringify(payload));
	child.stdin.end();

	if (detached) {
		await new Promise<void>((resolve, reject) => {
			child.once("error", (error) => {
				reject(formatSpawnError(error, command));
			});
			child.once("spawn", () => resolve());
		});
		child.unref();
		return;
	}

	if (!child.stdout || !child.stderr) {
		throw new Error("runSubprocessEvent failed to create stdout/stderr pipes");
	}

	let stdout = "";
	let stderr = "";
	let timedOut = false;
	let timeoutId: NodeJS.Timeout | undefined;

	child.stdout.on("data", (chunk: Buffer | string) => {
		stdout += chunk.toString();
	});
	child.stderr.on("data", (chunk: Buffer | string) => {
		stderr += chunk.toString();
	});

	return await new Promise<RunSubprocessEventResult>((resolve, reject) => {
		child.once("error", (error) => {
			reject(formatSpawnError(error, command));
		});
		if ((options.timeoutMs ?? 0) > 0) {
			timeoutId = setTimeout(() => {
				timedOut = true;
				child.kill("SIGKILL");
			}, options.timeoutMs);
		}
		child.once("close", (exitCode) => {
			if (timeoutId) {
				clearTimeout(timeoutId);
			}
			const { parsedJson, parseError } = parseStdout(stdout);
			resolve({
				exitCode,
				stdout,
				stderr,
				parsedJson,
				parseError,
				timedOut,
			});
		});
	});
}
