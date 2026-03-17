import type { Lock, StateAdapter } from "chat";
import type { CliLoggerAdapter } from "../logging/adapter";

export class InMemoryStateAdapter implements StateAdapter {
	private readonly values = new Map<
		string,
		{ expiresAt?: number; value: unknown }
	>();
	private readonly lists = new Map<
		string,
		{ expiresAt?: number; value: unknown[] }
	>();
	private readonly subscriptions = new Set<string>();
	private readonly locks = new Map<string, Lock>();

	async connect(): Promise<void> {}

	async disconnect(): Promise<void> {}

	async get<T = unknown>(key: string): Promise<T | null> {
		const entry = this.values.get(key);
		if (!entry) {
			return null;
		}
		if (entry.expiresAt && entry.expiresAt <= Date.now()) {
			this.values.delete(key);
			return null;
		}
		return entry.value as T;
	}

	async set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void> {
		this.values.set(key, {
			value,
			expiresAt: ttlMs ? Date.now() + ttlMs : undefined,
		});
	}

	async delete(key: string): Promise<void> {
		this.values.delete(key);
		this.lists.delete(key);
	}

	async subscribe(threadId: string): Promise<void> {
		this.subscriptions.add(threadId);
	}

	async unsubscribe(threadId: string): Promise<void> {
		this.subscriptions.delete(threadId);
	}

	async isSubscribed(threadId: string): Promise<boolean> {
		return this.subscriptions.has(threadId);
	}

	async acquireLock(threadId: string, ttlMs: number): Promise<Lock | null> {
		const existing = this.locks.get(threadId);
		if (existing && existing.expiresAt > Date.now()) {
			return null;
		}
		const lock: Lock = {
			threadId,
			token: crypto.randomUUID(),
			expiresAt: Date.now() + ttlMs,
		};
		this.locks.set(threadId, lock);
		return lock;
	}

	async extendLock(lock: Lock, ttlMs: number): Promise<boolean> {
		const existing = this.locks.get(lock.threadId);
		if (!existing || existing.token !== lock.token) {
			return false;
		}
		existing.expiresAt = Date.now() + ttlMs;
		return true;
	}

	async releaseLock(lock: Lock): Promise<void> {
		const existing = this.locks.get(lock.threadId);
		if (existing?.token === lock.token) {
			this.locks.delete(lock.threadId);
		}
	}

	async appendToList(
		key: string,
		value: unknown,
		options?: { maxLength?: number; ttlMs?: number },
	): Promise<void> {
		const existing = this.lists.get(key);
		const next = existing ? [...existing.value, value] : [value];
		const maxLength = options?.maxLength;
		const trimmed =
			typeof maxLength === "number" && maxLength > 0 && next.length > maxLength
				? next.slice(next.length - maxLength)
				: next;
		this.lists.set(key, {
			value: trimmed,
			expiresAt: options?.ttlMs ? Date.now() + options.ttlMs : undefined,
		});
	}

	async forceReleaseLock(threadId: string): Promise<void> {
		this.locks.delete(threadId);
	}

	async getList<T = unknown>(key: string): Promise<T[]> {
		const entry = this.lists.get(key);
		if (!entry) {
			return [];
		}
		if (entry.expiresAt && entry.expiresAt <= Date.now()) {
			this.lists.delete(key);
			return [];
		}
		return entry.value as T[];
	}

	async setIfNotExists(
		key: string,
		value: unknown,
		ttlMs?: number,
	): Promise<boolean> {
		const existing = await this.get(key);
		if (existing !== null) {
			return false;
		}
		await this.set(key, value, ttlMs);
		return true;
	}
}

export function createChatSdkLogger(adapter: CliLoggerAdapter) {
	return {
		child(prefix: string) {
			return createChatSdkLogger(adapter.child({ chatLogger: prefix }));
		},
		debug(message: string, ...args: unknown[]) {
			adapter.core.debug?.(message, args.length > 0 ? { args } : undefined);
		},
		info(message: string, ...args: unknown[]) {
			adapter.core.info?.(message, args.length > 0 ? { args } : undefined);
		},
		warn(message: string, ...args: unknown[]) {
			adapter.core.warn?.(message, args.length > 0 ? { args } : undefined);
		},
		error(message: string, ...args: unknown[]) {
			adapter.core.error?.(message, args.length > 0 ? { args } : undefined);
		},
	};
}

export async function enqueueThreadTurn(
	threadQueues: Map<string, Promise<void>>,
	threadId: string,
	work: () => Promise<void>,
): Promise<void> {
	const previous = threadQueues.get(threadId) ?? Promise.resolve();
	const current = previous
		.catch(() => {})
		.then(work)
		.finally(() => {
			if (threadQueues.get(threadId) === current) {
				threadQueues.delete(threadId);
			}
		});
	threadQueues.set(threadId, current);
	return current;
}

export type ConnectorWebhookHandler = (
	request: Request,
) => Response | Promise<Response>;

export type ConnectorWebhookServer = {
	close: () => Promise<void>;
};

async function readRequestBody(
	request: import("node:http").IncomingMessage,
): Promise<Uint8Array | undefined> {
	if (
		request.method === "GET" ||
		request.method === "HEAD" ||
		request.method === undefined
	) {
		return undefined;
	}
	const chunks: Buffer[] = [];
	for await (const chunk of request) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	const body = Buffer.concat(chunks);
	return body.length > 0 ? body : undefined;
}

export async function startConnectorWebhookServer(input: {
	host: string;
	port: number;
	routes: Record<string, ConnectorWebhookHandler>;
	notFound?: ConnectorWebhookHandler;
}): Promise<ConnectorWebhookServer> {
	const http = await import("node:http");

	const server = http.createServer(async (req, res) => {
		try {
			const hostHeader = req.headers.host || `${input.host}:${input.port}`;
			const requestUrl = new URL(req.url || "/", `http://${hostHeader}`);
			const body = await readRequestBody(req);
			const request = new Request(requestUrl.toString(), {
				method: req.method,
				headers: new Headers(
					Object.entries(req.headers).flatMap(([key, value]) => {
						if (Array.isArray(value)) {
							return value.map((entry) => [key, entry] as [string, string]);
						}
						return typeof value === "string" ? [[key, value]] : [];
					}),
				),
				body,
				duplex: body ? "half" : undefined,
			});
			const handler =
				input.routes[requestUrl.pathname] ??
				input.notFound ??
				(() => new Response("Not Found", { status: 404 }));
			const response = await handler(request);
			res.statusCode = response.status;
			response.headers.forEach((value, key) => {
				res.setHeader(key, value);
			});
			const buffer = Buffer.from(await response.arrayBuffer());
			res.end(buffer);
		} catch (error) {
			res.statusCode = 500;
			res.end(error instanceof Error ? error.message : "Internal Server Error");
		}
	});

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(input.port, input.host, () => {
			server.off("error", reject);
			resolve();
		});
	});

	return {
		close: async () => {
			await new Promise<void>((resolve, reject) => {
				server.close((error) => {
					if (error) {
						reject(error);
						return;
					}
					resolve();
				});
			});
		},
	};
}
