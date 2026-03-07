import { type ChildProcess, spawn } from "node:child_process";

interface SandboxCallMessage {
	type: "call";
	id: string;
	method: string;
	args: unknown;
}

interface SandboxResponseMessage {
	type: "response";
	id: string;
	ok: boolean;
	result?: unknown;
	error?: { message: string; stack?: string };
}

export interface SubprocessSandboxOptions {
	bootstrapScript: string;
	name?: string;
}

export interface SandboxCallOptions {
	timeoutMs?: number;
}

type PendingRequest = {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timeout?: NodeJS.Timeout;
};

function asError(value: unknown): Error {
	if (value instanceof Error) {
		return value;
	}
	return new Error(String(value));
}

export class SubprocessSandbox {
	private readonly options: SubprocessSandboxOptions;
	private process: ChildProcess | null = null;
	private requestCounter = 0;
	private readonly pending = new Map<string, PendingRequest>();

	constructor(options: SubprocessSandboxOptions) {
		this.options = options;
	}

	start(): void {
		if (this.process && this.process.exitCode === null) {
			return;
		}

		const child = spawn(
			process.execPath,
			["-e", this.options.bootstrapScript],
			{
				stdio: ["ignore", "ignore", "ignore", "ipc"],
			},
		);
		this.process = child;
		child.on("message", (message) => {
			this.onMessage(message as SandboxResponseMessage);
		});
		child.on("error", (error) => {
			this.failPending(
				new Error(
					`${this.options.name ?? "sandbox"} process error: ${asError(error).message}`,
				),
			);
		});
		child.on("exit", (code, signal) => {
			this.process = null;
			this.failPending(
				new Error(
					`${this.options.name ?? "sandbox"} process exited (code=${String(code)}, signal=${String(signal)})`,
				),
			);
		});
	}

	async call<TResult = unknown>(
		method: string,
		args: unknown,
		options: SandboxCallOptions = {},
	): Promise<TResult> {
		this.start();
		const child = this.process;
		if (!child || child.exitCode !== null) {
			throw new Error(
				`${this.options.name ?? "sandbox"} process is not available`,
			);
		}

		const id = `req_${++this.requestCounter}`;
		const message: SandboxCallMessage = {
			type: "call",
			id,
			method,
			args,
		};

		return await new Promise<TResult>((resolve, reject) => {
			const pending: PendingRequest = {
				resolve: (value) => resolve(value as TResult),
				reject,
			};
			if ((options.timeoutMs ?? 0) > 0) {
				pending.timeout = setTimeout(() => {
					this.pending.delete(id);
					this.shutdown().catch(() => {
						// Best-effort process shutdown after timeout.
					});
					reject(
						new Error(
							`${this.options.name ?? "sandbox"} call timed out after ${options.timeoutMs}ms: ${method}`,
						),
					);
				}, options.timeoutMs);
			}
			this.pending.set(id, pending);
			child.send(message, (error) => {
				if (!error) {
					return;
				}
				const entry = this.pending.get(id);
				if (!entry) {
					return;
				}
				this.pending.delete(id);
				if (entry.timeout) {
					clearTimeout(entry.timeout);
				}
				entry.reject(
					new Error(
						`${this.options.name ?? "sandbox"} failed to send call "${method}": ${asError(error).message}`,
					),
				);
			});
		});
	}

	async shutdown(): Promise<void> {
		const child = this.process;
		this.process = null;
		if (!child || child.exitCode !== null) {
			this.failPending(new Error(`${this.options.name ?? "sandbox"} shutdown`));
			return;
		}
		await new Promise<void>((resolve) => {
			const timeout = setTimeout(() => {
				try {
					child.kill("SIGKILL");
				} catch {
					// Ignore kill failures.
				}
				resolve();
			}, 300);
			child.once("exit", () => {
				clearTimeout(timeout);
				resolve();
			});
			try {
				child.kill("SIGTERM");
			} catch {
				clearTimeout(timeout);
				resolve();
			}
		});
		this.failPending(new Error(`${this.options.name ?? "sandbox"} shutdown`));
	}

	private onMessage(message: SandboxResponseMessage): void {
		if (!message || message.type !== "response" || !message.id) {
			return;
		}
		const pending = this.pending.get(message.id);
		if (!pending) {
			return;
		}
		this.pending.delete(message.id);
		if (pending.timeout) {
			clearTimeout(pending.timeout);
		}
		if (message.ok) {
			pending.resolve(message.result);
			return;
		}
		pending.reject(
			new Error(
				message.error?.message ||
					`${this.options.name ?? "sandbox"} call failed`,
			),
		);
	}

	private failPending(error: Error): void {
		for (const [id, pending] of this.pending.entries()) {
			this.pending.delete(id);
			if (pending.timeout) {
				clearTimeout(pending.timeout);
			}
			pending.reject(error);
		}
	}
}
