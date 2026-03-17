import { spawn } from "node:child_process";
import {
	existsSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createTelegramAdapter } from "@chat-adapter/telegram";
import {
	CoreSessionService,
	ProviderSettingsManager,
	SqliteSessionStore,
} from "@cline/core/server";
import type { RpcSessionRow } from "@cline/rpc";
import { RpcSessionClient, registerRpcClient } from "@cline/rpc";
import type {
	RpcChatRunTurnRequest,
	RpcChatRuntimeLoggerConfig,
	RpcChatStartSessionRequest,
} from "@cline/shared";
import { ensureParentDir, resolveClineDataDir } from "@cline/shared/storage";
import {
	Chat,
	ConsoleLogger,
	type Lock,
	type SerializedThread,
	type StateAdapter,
	type Thread,
} from "chat";
import {
	type ChatCommandState,
	maybeHandleChatCommand,
} from "../chat-commands";
import {
	ensureOAuthProviderApiKey,
	getPersistedProviderApiKey,
	isOAuthProvider,
	normalizeProviderId,
} from "../commands/auth";
import { ensureRpcRuntimeAddress } from "../commands/rpc";
import {
	type CliLoggerAdapter,
	createCliLoggerAdapter,
} from "../logging/adapter";
import { resolveSystemPrompt } from "../runtime/prompt";
import { resolveWorkspaceRoot } from "../utils/helpers";
import { dispatchConnectorHook } from "./hooks";
import type {
	ConnectCommandDefinition,
	ConnectIo,
	ConnectStopResult,
} from "./types";

const TELEGRAM_SYSTEM_RULES = [
	"Keep answers compact and optimized for a chat app unless the user asks for detail.",
	"Prefer short paragraphs and concise lists suitable for Telegram.",
	"When tools are disabled, explain limits briefly and ask for /tools if tool usage is required.",
].join("\n");

type TelegramThreadState = {
	sessionId?: string;
	enableTools?: boolean;
	autoApproveTools?: boolean;
	cwd?: string;
	workspaceRoot?: string;
	systemPrompt?: string;
};

type ConnectTelegramOptions = {
	botToken: string;
	botUsername: string;
	cwd: string;
	model?: string;
	provider?: string;
	apiKey?: string;
	systemPrompt?: string;
	mode: "act" | "plan";
	interactive: boolean;
	maxIterations?: number;
	enableTools: boolean;
	rpcAddress: string;
	hookCommand?: string;
};

type TelegramConnectorState = {
	botUsername: string;
	pid: number;
	rpcAddress: string;
	startedAt: string;
};

type TelegramThreadBinding = {
	channelId: string;
	isDM: boolean;
	serializedThread: string;
	sessionId?: string;
	state?: TelegramThreadState;
	updatedAt: string;
};

type TelegramBindingStore = Record<string, TelegramThreadBinding>;

type SerializableTelegramThread = Thread<TelegramThreadState> & {
	toJSON(): SerializedThread;
};

class InMemoryStateAdapter implements StateAdapter {
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

function createChatSdkLogger(adapter: CliLoggerAdapter) {
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

function parseBooleanFlag(rawArgs: string[], flag: string): boolean {
	return rawArgs.includes(flag);
}

function parseStringFlag(
	rawArgs: string[],
	shortFlag: string,
	longFlag: string,
): string | undefined {
	for (let index = 0; index < rawArgs.length; index += 1) {
		const value = rawArgs[index];
		if (value !== shortFlag && value !== longFlag) {
			continue;
		}
		const next = rawArgs[index + 1]?.trim();
		return next ? next : undefined;
	}
	return undefined;
}

function parseIntegerFlag(
	rawArgs: string[],
	shortFlag: string,
	longFlag: string,
): number | undefined {
	const raw = parseStringFlag(rawArgs, shortFlag, longFlag);
	if (!raw) {
		return undefined;
	}
	const parsed = Number.parseInt(raw, 10);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function isProcessRunning(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) {
		return false;
	}
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function truncateText(value: string, maxLength = 160): string {
	const singleLine = value.replace(/\s+/g, " ").trim();
	if (singleLine.length <= maxLength) {
		return singleLine;
	}
	return `${singleLine.slice(0, maxLength - 3)}...`;
}

function resolveConnectorStatePath(botUsername: string): string {
	const safe = botUsername.replace(/[^a-zA-Z0-9._-]+/g, "_");
	return join(resolveClineDataDir(), "connectors", "telegram", `${safe}.json`);
}

function resolveBindingsPath(botUsername: string): string {
	const safe = botUsername.replace(/[^a-zA-Z0-9._-]+/g, "_");
	return join(
		resolveClineDataDir(),
		"connectors",
		"telegram",
		`${safe}.threads.json`,
	);
}

function resolveTelegramConnectorDir(): string {
	return join(resolveClineDataDir(), "connectors", "telegram");
}

function listConnectorStatePaths(): string[] {
	const dir = resolveTelegramConnectorDir();
	if (!existsSync(dir)) {
		return [];
	}
	return readdirSync(dir)
		.filter((name) => name.endsWith(".json") && !name.endsWith(".threads.json"))
		.map((name) => join(dir, name));
}

function readConnectorState(
	statePath: string,
): TelegramConnectorState | undefined {
	if (!existsSync(statePath)) {
		return undefined;
	}
	try {
		const raw = readFileSync(statePath, "utf8");
		const parsed = JSON.parse(raw) as TelegramConnectorState;
		if (
			!parsed ||
			typeof parsed !== "object" ||
			typeof parsed.pid !== "number" ||
			typeof parsed.botUsername !== "string"
		) {
			return undefined;
		}
		return parsed;
	} catch {
		return undefined;
	}
}

function writeConnectorState(
	statePath: string,
	state: TelegramConnectorState,
): void {
	ensureParentDir(statePath);
	writeFileSync(statePath, JSON.stringify(state, null, 2), "utf8");
}

function removeConnectorState(statePath: string): void {
	try {
		rmSync(statePath, { force: true });
	} catch {}
}

function parseSessionMetadata(
	row:
		| RpcSessionRow
		| {
				metadata?: Record<string, unknown>;
				parentSessionId?: string | null;
				sessionId: string;
		  },
): {
	transport?: string;
	botUserName?: string;
	parentSessionId?: string;
} {
	const metadata =
		row.metadata && typeof row.metadata === "object" ? row.metadata : undefined;
	return {
		transport:
			typeof metadata?.transport === "string" ? metadata.transport : undefined,
		botUserName:
			typeof metadata?.botUserName === "string"
				? metadata.botUserName
				: undefined,
		parentSessionId: row.parentSessionId?.trim() || undefined,
	};
}

async function terminateProcess(pid: number): Promise<boolean> {
	if (!isProcessRunning(pid)) {
		return false;
	}
	try {
		process.kill(pid, "SIGTERM");
	} catch {
		return false;
	}
	for (let attempt = 0; attempt < 20; attempt += 1) {
		if (!isProcessRunning(pid)) {
			return true;
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	try {
		process.kill(pid, "SIGKILL");
	} catch {
		return false;
	}
	for (let attempt = 0; attempt < 10; attempt += 1) {
		if (!isProcessRunning(pid)) {
			return true;
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	return !isProcessRunning(pid);
}

async function listTelegramSessionsFromRpc(
	address: string,
	botUsername: string,
): Promise<{ client: RpcSessionClient; rows: RpcSessionRow[] } | undefined> {
	const client = new RpcSessionClient({ address });
	try {
		const rows = await client.listSessions({ limit: 5000 });
		return {
			client,
			rows: rows.filter((row) => {
				const metadata = parseSessionMetadata(row);
				return (
					metadata.transport === "telegram" &&
					metadata.botUserName === botUsername &&
					!metadata.parentSessionId
				);
			}),
		};
	} catch {
		client.close();
		return undefined;
	}
}

async function listTelegramSessionsFromLocalStore(
	botUsername: string,
): Promise<Array<{ sessionId: string }>> {
	const service = new CoreSessionService(new SqliteSessionStore());
	const rows = await service.listSessions(5000);
	return rows
		.filter((row) => {
			let metadata: Record<string, unknown> | undefined;
			if (typeof row.metadata_json === "string" && row.metadata_json.trim()) {
				try {
					const parsed = JSON.parse(row.metadata_json) as unknown;
					if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
						metadata = parsed as Record<string, unknown>;
					}
				} catch {
					metadata = undefined;
				}
			}
			return (
				typeof metadata?.transport === "string" &&
				metadata.transport === "telegram" &&
				typeof metadata?.botUserName === "string" &&
				metadata.botUserName === botUsername &&
				!(row.parent_session_id?.trim() || "")
			);
		})
		.map((row) => ({ sessionId: row.session_id }));
}

async function stopSessionsForBot(
	state: TelegramConnectorState,
): Promise<number> {
	const rpcListing = await listTelegramSessionsFromRpc(
		state.rpcAddress,
		state.botUsername,
	);
	if (rpcListing) {
		const { client, rows } = rpcListing;
		try {
			await Promise.allSettled(
				rows.map(async (row) => {
					try {
						await client.stopRuntimeSession(row.sessionId);
					} catch {
						// Best-effort runtime stop.
					}
					try {
						await client.deleteSession(row.sessionId, true);
					} catch {
						// Best-effort persistence cleanup.
					}
				}),
			);
		} finally {
			client.close();
		}
		return rows.length;
	}

	const rows = await listTelegramSessionsFromLocalStore(state.botUsername);
	const service = new CoreSessionService(new SqliteSessionStore());
	await Promise.allSettled(
		rows.map(async (row) => {
			await service.deleteSession(row.sessionId);
		}),
	);
	return rows.length;
}

function clearBindingSessionIds(botUsername: string): void {
	const path = resolveBindingsPath(botUsername);
	const bindings = readBindings(path);
	let updated = false;
	for (const binding of Object.values(bindings)) {
		if (binding.sessionId || binding.state?.sessionId) {
			binding.sessionId = undefined;
			if (binding.state) {
				binding.state.sessionId = undefined;
			}
			updated = true;
		}
	}
	if (updated) {
		writeBindings(path, bindings);
	}
}

async function stopTelegramConnectorInstance(
	statePath: string,
	io: ConnectIo,
): Promise<ConnectStopResult> {
	const state = readConnectorState(statePath);
	if (!state) {
		removeConnectorState(statePath);
		return { stoppedProcesses: 0, stoppedSessions: 0 };
	}
	let stoppedProcesses = 0;
	if (await terminateProcess(state.pid)) {
		stoppedProcesses = 1;
		io.writeln(`[telegram] stopped pid=${state.pid} bot=@${state.botUsername}`);
	}
	const stoppedSessions = await stopSessionsForBot(state);
	clearBindingSessionIds(state.botUsername);
	removeConnectorState(statePath);
	return { stoppedProcesses, stoppedSessions };
}

function readBindings(path: string): TelegramBindingStore {
	if (!existsSync(path)) {
		return {};
	}
	try {
		const raw = readFileSync(path, "utf8");
		const parsed = JSON.parse(raw) as TelegramBindingStore;
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
}

function writeBindings(path: string, bindings: TelegramBindingStore): void {
	ensureParentDir(path);
	writeFileSync(path, JSON.stringify(bindings, null, 2), "utf8");
}

function persistThreadBinding(
	path: string,
	thread: Thread<TelegramThreadState>,
	state: TelegramThreadState,
): void {
	const bindings = readBindings(path);
	bindings[thread.id] = {
		channelId: thread.channelId,
		isDM: thread.isDM,
		serializedThread: serializeTelegramThread(thread),
		sessionId: state.sessionId,
		state,
		updatedAt: new Date().toISOString(),
	};
	writeBindings(path, bindings);
}

function serializeTelegramThread(thread: Thread<TelegramThreadState>): string {
	const candidate = thread as Partial<SerializableTelegramThread>;
	if (typeof candidate.toJSON !== "function") {
		throw new Error("Telegram thread cannot be serialized");
	}
	return JSON.stringify(candidate.toJSON.call(thread));
}

function mergeThreadState(
	threadState: TelegramThreadState | null | undefined,
	bindingState: TelegramThreadState | undefined,
	base: RpcChatStartSessionRequest,
): TelegramThreadState {
	return {
		sessionId:
			threadState?.sessionId?.trim() ||
			bindingState?.sessionId?.trim() ||
			undefined,
		enableTools:
			threadState?.enableTools ?? bindingState?.enableTools ?? base.enableTools,
		autoApproveTools:
			threadState?.autoApproveTools ??
			bindingState?.autoApproveTools ??
			base.autoApproveTools === true,
		cwd: threadState?.cwd || bindingState?.cwd || base.cwd,
		workspaceRoot:
			threadState?.workspaceRoot ||
			bindingState?.workspaceRoot ||
			base.workspaceRoot,
		systemPrompt:
			threadState?.systemPrompt ||
			bindingState?.systemPrompt ||
			base.systemPrompt,
	};
}

async function loadThreadState(
	thread: Thread<TelegramThreadState>,
	bindingsPath: string,
	base: RpcChatStartSessionRequest,
): Promise<TelegramThreadState> {
	const binding = readBindings(bindingsPath)[thread.id];
	return mergeThreadState(await thread.state, binding?.state, base);
}

async function persistMergedThreadState(
	thread: Thread<TelegramThreadState>,
	bindingsPath: string,
	nextState: TelegramThreadState,
): Promise<void> {
	await thread.setState(nextState, { replace: true });
	persistThreadBinding(bindingsPath, thread, nextState);
}

function buildThreadStartRequest(
	base: RpcChatStartSessionRequest,
	state: TelegramThreadState,
): RpcChatStartSessionRequest {
	const enableTools = state.enableTools ?? base.enableTools;
	return {
		...base,
		enableTools,
		enableSpawn: enableTools,
		enableTeams: enableTools,
		autoApproveTools: state.autoApproveTools ?? base.autoApproveTools,
		cwd: state.cwd || base.cwd,
		workspaceRoot: state.workspaceRoot || base.workspaceRoot,
		systemPrompt: state.systemPrompt || base.systemPrompt,
	};
}

function spawnDetachedTelegramConnector(rawArgs: string[]): number {
	const launcher = process.argv[0];
	const entry = process.argv[1];
	const childArgs = entry ? [entry, ...rawArgs, "-i"] : [...rawArgs, "-i"];
	const child = spawn(launcher, childArgs, {
		cwd: process.cwd(),
		detached: true,
		stdio: "ignore",
		env: {
			...process.env,
			CLINE_TELEGRAM_CONNECT_CHILD: "1",
		},
	});
	child.unref();
	return child.pid ?? 0;
}

function showConnectTelegramHelp(io: ConnectIo): void {
	io.writeln("Usage:");
	io.writeln(
		"  clite connect telegram -m <TELEGRAM_BOT_USERNAME> -k <TELEGRAM_BOT_TOKEN>",
	);
	io.writeln("");
	io.writeln("Options:");
	io.writeln("  -m, --bot-username <name>   Telegram bot username");
	io.writeln("  -k, --bot-token <token>     Telegram bot token");
	io.writeln("  --provider <id>             Provider override");
	io.writeln("  --model <id>                Model override");
	io.writeln("  --api-key <key>             Provider API key override");
	io.writeln("  --system <prompt>           System prompt override");
	io.writeln("  --cwd <path>                Workspace / cwd for runtime");
	io.writeln("  --mode <act|plan>           Agent mode (default: act)");
	io.writeln("  -i, --interactive           Keep connector in foreground");
	io.writeln("  --max-iterations <n>        Optional max iterations");
	io.writeln(
		"  --enable-tools              Enable tools for Telegram sessions",
	);
	io.writeln(
		"  --hook-command <command>    Run a shell command for connector events",
	);
	io.writeln(
		"  --rpc-address <host:port>   RPC address (default: 127.0.0.1:4317)",
	);
	io.writeln("");
	io.writeln("Notes:");
	io.writeln("  - Without -i, the connector is launched in the background.");
	io.writeln("  - Tools are disabled by default for Telegram sessions.");
	io.writeln(
		"  - Provider/model default to the CLI's last-used provider settings.",
	);
}

function parseConnectTelegramArgs(rawArgs: string[]): ConnectTelegramOptions {
	const connectArgs = rawArgs.slice(2);
	if (
		parseBooleanFlag(connectArgs, "-h") ||
		parseBooleanFlag(connectArgs, "--help")
	) {
		throw new Error("__SHOW_HELP__");
	}

	const botUsername =
		parseStringFlag(connectArgs, "-m", "--bot-username") ||
		process.env.TELEGRAM_BOT_USERNAME?.trim();
	const botToken =
		parseStringFlag(connectArgs, "-k", "--bot-token") ||
		process.env.TELEGRAM_BOT_TOKEN?.trim();
	if (!botUsername) {
		throw new Error("connect telegram requires -m/--bot-username <name>");
	}
	if (!botToken) {
		throw new Error("connect telegram requires -k/--bot-token <token>");
	}

	const modeRaw =
		parseStringFlag(connectArgs, "", "--mode")?.toLowerCase() || "act";
	if (modeRaw !== "act" && modeRaw !== "plan") {
		throw new Error(`invalid mode "${modeRaw}" (expected "act" or "plan")`);
	}

	return {
		botToken,
		botUsername,
		cwd: parseStringFlag(connectArgs, "", "--cwd") || process.cwd(),
		model: parseStringFlag(connectArgs, "", "--model"),
		provider: parseStringFlag(connectArgs, "", "--provider"),
		apiKey: parseStringFlag(connectArgs, "", "--api-key"),
		systemPrompt: parseStringFlag(connectArgs, "-s", "--system"),
		mode: modeRaw,
		interactive:
			parseBooleanFlag(connectArgs, "-i") ||
			parseBooleanFlag(connectArgs, "--interactive"),
		maxIterations: parseIntegerFlag(connectArgs, "-n", "--max-iterations"),
		enableTools: parseBooleanFlag(connectArgs, "--enable-tools"),
		rpcAddress:
			parseStringFlag(connectArgs, "", "--rpc-address") ||
			process.env.CLINE_RPC_ADDRESS?.trim() ||
			"127.0.0.1:4317",
		hookCommand:
			parseStringFlag(connectArgs, "", "--hook-command") ||
			process.env.CLINE_CONNECT_HOOK_COMMAND?.trim(),
	};
}

async function buildTelegramStartRequest(
	options: ConnectTelegramOptions,
	io: ConnectIo,
	loggerConfig: RpcChatRuntimeLoggerConfig,
): Promise<RpcChatStartSessionRequest> {
	const providerSettingsManager = new ProviderSettingsManager();
	const lastUsedProviderSettings =
		providerSettingsManager.getLastUsedProviderSettings();
	const provider = normalizeProviderId(
		options.provider?.trim() || lastUsedProviderSettings?.provider || "cline",
	);
	let selectedProviderSettings =
		providerSettingsManager.getProviderSettings(provider);
	const persistedApiKey = getPersistedProviderApiKey(
		provider,
		selectedProviderSettings,
	);
	let apiKey = options.apiKey?.trim() || persistedApiKey || "";

	if (!apiKey && isOAuthProvider(provider)) {
		const oauthResult = await ensureOAuthProviderApiKey({
			providerId: provider,
			currentApiKey: apiKey,
			existingSettings: selectedProviderSettings,
			providerSettingsManager,
			io,
		});
		selectedProviderSettings = oauthResult.selectedProviderSettings;
		apiKey = oauthResult.apiKey ?? "";
	}

	const cwd = options.cwd;
	const systemPrompt = await resolveSystemPrompt({
		cwd,
		explicitSystemPrompt: options.systemPrompt,
		providerId: provider,
		rules: TELEGRAM_SYSTEM_RULES,
	});
	return {
		workspaceRoot: resolveWorkspaceRoot(cwd),
		cwd,
		provider,
		model:
			options.model?.trim() ||
			selectedProviderSettings?.model ||
			"anthropic/claude-sonnet-4.6",
		mode: options.mode,
		apiKey,
		systemPrompt,
		logger: loggerConfig,
		maxIterations: options.maxIterations,
		enableTools: options.enableTools,
		enableSpawn: options.enableTools,
		enableTeams: options.enableTools,
		autoApproveTools: false,
		teamName: `telegram-${options.botUsername.replace(/[^a-zA-Z0-9_-]+/g, "-")}`,
		missionStepInterval: 3,
		missionTimeIntervalMs: 120000,
	};
}

async function enqueueThreadTurn(
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

async function getOrCreateSessionId(
	thread: Thread<TelegramThreadState>,
	client: RpcSessionClient,
	startRequest: RpcChatStartSessionRequest,
	logger: CliLoggerAdapter,
	clientId: string,
	botUsername: string,
	bindingsPath: string,
	hookCommand?: string,
): Promise<string> {
	const threadState = await loadThreadState(thread, bindingsPath, startRequest);
	const existing = threadState.sessionId?.trim();
	if (existing) {
		await persistMergedThreadState(thread, bindingsPath, {
			...threadState,
			sessionId: existing,
		});
		logger.core.info?.("Telegram thread reusing RPC session", {
			transport: "telegram",
			threadId: thread.id,
			sessionId: existing,
		});
		await dispatchConnectorHook(
			hookCommand,
			{
				adapter: "telegram",
				botUserName: botUsername,
				event: "session.reused",
				payload: {
					threadId: thread.id,
					channelId: thread.channelId,
					sessionId: existing,
				},
				ts: new Date().toISOString(),
			},
			logger,
		);
		return existing;
	}
	const started = await client.startRuntimeSession(startRequest);
	const sessionId = started.sessionId.trim();
	if (!sessionId) {
		throw new Error("runtime start returned an empty session id");
	}
	await client
		.updateSession({
			sessionId,
			metadata: {
				transport: "telegram",
				botUserName: botUsername,
				telegramThreadId: thread.id,
				telegramChannelId: thread.channelId,
				isDM: thread.isDM,
				rpcClientId: clientId,
				connectorPid: process.pid,
			},
		})
		.catch(() => undefined);
	await persistMergedThreadState(thread, bindingsPath, {
		...threadState,
		sessionId,
	});
	logger.core.info?.("Telegram thread started RPC session", {
		transport: "telegram",
		threadId: thread.id,
		channelId: thread.channelId,
		isDM: thread.isDM,
		sessionId,
	});
	await dispatchConnectorHook(
		hookCommand,
		{
			adapter: "telegram",
			botUserName: botUsername,
			event: "session.started",
			payload: {
				threadId: thread.id,
				channelId: thread.channelId,
				isDM: thread.isDM,
				sessionId,
			},
			ts: new Date().toISOString(),
		},
		logger,
	);
	return sessionId;
}

async function clearSession(
	thread: Thread<TelegramThreadState>,
	client: RpcSessionClient,
	bindingsPath: string,
	baseStartRequest: RpcChatStartSessionRequest,
): Promise<void> {
	const threadState = await loadThreadState(
		thread,
		bindingsPath,
		baseStartRequest,
	);
	const sessionId = threadState.sessionId?.trim();
	if (sessionId) {
		try {
			await client.stopRuntimeSession(sessionId);
		} catch {}
		try {
			await client.deleteSession(sessionId, true);
		} catch {}
	}
	await persistMergedThreadState(thread, bindingsPath, {
		...threadState,
		sessionId: undefined,
	});
}

function createRpcTurnStream(input: {
	client: RpcSessionClient;
	sessionId: string;
	request: RpcChatRunTurnRequest;
	clientId: string;
	logger: CliLoggerAdapter;
	threadId: string;
	botUsername: string;
	hookCommand?: string;
}): AsyncIterable<string> {
	type QueueItem =
		| { type: "chunk"; value: string }
		| { type: "error"; error: Error }
		| { type: "end" };

	return {
		[Symbol.asyncIterator]: async function* () {
			const queue: QueueItem[] = [];
			let notify: (() => void) | undefined;
			let streamedText = "";
			let closed = false;

			const push = (item: QueueItem) => {
				queue.push(item);
				notify?.();
				notify = undefined;
			};

			const resolveTextDelta = (
				payload: Record<string, unknown>,
				previous: string,
			): { delta: string; nextText: string } => {
				const accumulated =
					typeof payload.accumulated === "string"
						? payload.accumulated
						: undefined;
				if (typeof accumulated === "string") {
					if (accumulated.startsWith(previous)) {
						return {
							delta: accumulated.slice(previous.length),
							nextText: accumulated,
						};
					}
					if (previous.startsWith(accumulated)) {
						return {
							delta: "",
							nextText: previous,
						};
					}
				}
				const text = typeof payload.text === "string" ? payload.text : "";
				return {
					delta: text,
					nextText: `${previous}${text}`,
				};
			};

			const stopStreaming = input.client.streamEvents(
				{
					clientId: input.clientId,
					sessionIds: [input.sessionId],
				},
				{
					onEvent: (event) => {
						if (event.eventType === "approval.requested") {
							const approvalId =
								typeof event.payload.approvalId === "string"
									? event.payload.approvalId.trim()
									: "";
							if (approvalId) {
								void input.client.respondToolApproval({
									approvalId,
									approved: false,
									reason:
										"Telegram connector does not support interactive tool approvals.",
									responderClientId: input.clientId,
								});
							}
							return;
						}
						if (event.eventType !== "runtime.chat.text_delta") {
							return;
						}
						const resolved = resolveTextDelta(event.payload, streamedText);
						streamedText = resolved.nextText;
						if (resolved.delta) {
							push({ type: "chunk", value: resolved.delta });
						}
					},
					onError: (error) => {
						push({ type: "error", error });
					},
				},
			);

			const runTurn = input.client
				.sendRuntimeSession(input.sessionId, input.request)
				.then(async (response) => {
					const finalText = response.result.text ?? "";
					input.logger.core.info?.("Telegram reply completed", {
						transport: "telegram",
						threadId: input.threadId,
						sessionId: input.sessionId,
						outputLength: finalText.length,
						outputPreview: truncateText(finalText),
						finishReason: response.result.finishReason,
						iterations: response.result.iterations,
					});
					await dispatchConnectorHook(
						input.hookCommand,
						{
							adapter: "telegram",
							botUserName: input.botUsername,
							event: "message.completed",
							payload: {
								threadId: input.threadId,
								sessionId: input.sessionId,
								finishReason: response.result.finishReason,
								iterations: response.result.iterations,
								outputPreview: truncateText(finalText),
								outputLength: finalText.length,
							},
							ts: new Date().toISOString(),
						},
						input.logger,
					);
					if (finalText?.startsWith(streamedText)) {
						const remainder = finalText.slice(streamedText.length);
						if (remainder) {
							push({ type: "chunk", value: remainder });
						}
					} else if (finalText && finalText !== streamedText) {
						push({ type: "chunk", value: finalText });
					}
				})
				.catch(async (error) => {
					input.logger.core.error?.("Telegram reply failed", {
						transport: "telegram",
						threadId: input.threadId,
						sessionId: input.sessionId,
						error,
					});
					await dispatchConnectorHook(
						input.hookCommand,
						{
							adapter: "telegram",
							botUserName: input.botUsername,
							event: "message.failed",
							payload: {
								threadId: input.threadId,
								sessionId: input.sessionId,
								error: error instanceof Error ? error.message : String(error),
							},
							ts: new Date().toISOString(),
						},
						input.logger,
					);
					push({
						type: "error",
						error: error instanceof Error ? error : new Error(String(error)),
					});
				})
				.finally(() => {
					stopStreaming();
					push({ type: "end" });
				});

			try {
				while (!closed) {
					if (queue.length === 0) {
						await new Promise<void>((resolve) => {
							notify = resolve;
						});
					}
					const item = queue.shift();
					if (!item) {
						continue;
					}
					if (item.type === "chunk") {
						yield item.value;
						continue;
					}
					if (item.type === "error") {
						throw item.error;
					}
					closed = true;
				}
			} finally {
				stopStreaming();
				await runTurn.catch(() => {});
			}
		},
	};
}

async function readSessionReplyText(
	client: RpcSessionClient,
	sessionId: string,
): Promise<string | undefined> {
	const session = await client.getSession(sessionId);
	const path = session?.messagesPath?.trim();
	if (!path || !existsSync(path)) {
		return undefined;
	}
	try {
		const raw = await readFile(path, "utf8");
		if (!raw.trim()) {
			return undefined;
		}
		const parsed = JSON.parse(raw) as { messages?: unknown[] } | unknown[];
		const messages = Array.isArray(parsed)
			? parsed
			: Array.isArray(parsed.messages)
				? parsed.messages
				: [];
		for (let index = messages.length - 1; index >= 0; index -= 1) {
			const message = messages[index] as Record<string, unknown>;
			if (message?.role !== "assistant") {
				continue;
			}
			const content = message.content;
			if (typeof content === "string" && content.trim()) {
				return content.trim();
			}
			if (Array.isArray(content)) {
				const joined = content
					.map((part) => {
						if (typeof part === "string") {
							return part;
						}
						if (!part || typeof part !== "object") {
							return "";
						}
						const record = part as Record<string, unknown>;
						if (typeof record.text === "string") {
							return record.text;
						}
						return "";
					})
					.join("")
					.trim();
				if (joined) {
					return joined;
				}
			}
		}
	} catch {}
	return undefined;
}

async function deliverScheduledResult(input: {
	bot: Chat;
	client: RpcSessionClient;
	logger: CliLoggerAdapter;
	bindingsPath: string;
	botUsername: string;
	scheduleId: string;
	executionId: string;
	sessionId?: string;
	status: string;
	errorMessage?: string;
	hookCommand?: string;
}): Promise<void> {
	const schedule = await input.client.getSchedule(input.scheduleId);
	const delivery = schedule?.metadata?.delivery as
		| Record<string, unknown>
		| undefined;
	if (!delivery || delivery.adapter !== "telegram") {
		return;
	}
	const targetBot =
		typeof delivery.botUserName === "string" ? delivery.botUserName.trim() : "";
	if (targetBot && targetBot !== input.botUsername) {
		return;
	}
	const threadId =
		typeof delivery.threadId === "string" ? delivery.threadId.trim() : "";
	if (!threadId) {
		return;
	}
	const binding = readBindings(input.bindingsPath)[threadId];
	if (!binding?.serializedThread) {
		input.logger.core.warn?.(
			"Scheduled Telegram delivery skipped: missing thread binding",
			{
				transport: "telegram",
				scheduleId: input.scheduleId,
				executionId: input.executionId,
				threadId,
			},
		);
		return;
	}
	await dispatchConnectorHook(
		input.hookCommand,
		{
			adapter: "telegram",
			botUserName: input.botUsername,
			event: "schedule.delivery.started",
			payload: {
				threadId,
				scheduleId: input.scheduleId,
				executionId: input.executionId,
				sessionId: input.sessionId,
				status: input.status,
			},
			ts: new Date().toISOString(),
		},
		input.logger,
	);
	const thread = JSON.parse(
		binding.serializedThread,
		input.bot.reviver(),
	) as Thread;
	let body = "";
	if (input.status === "success" && input.sessionId) {
		const text = await readSessionReplyText(input.client, input.sessionId);
		body = text?.trim()
			? text
			: `Schedule "${schedule?.name ?? input.scheduleId}" completed, but no assistant reply text was found.`;
	} else {
		body = `Schedule "${schedule?.name ?? input.scheduleId}" ${input.status}.${input.errorMessage ? `\n\n${input.errorMessage}` : ""}`;
	}
	try {
		await thread.post(body);
		input.logger.core.info?.("Scheduled Telegram delivery sent", {
			transport: "telegram",
			threadId,
			scheduleId: input.scheduleId,
			executionId: input.executionId,
			status: input.status,
			outputPreview: truncateText(body),
		});
		await dispatchConnectorHook(
			input.hookCommand,
			{
				adapter: "telegram",
				botUserName: input.botUsername,
				event: "schedule.delivery.sent",
				payload: {
					threadId,
					scheduleId: input.scheduleId,
					executionId: input.executionId,
					status: input.status,
					outputPreview: truncateText(body),
				},
				ts: new Date().toISOString(),
			},
			input.logger,
		);
	} catch (error) {
		input.logger.core.error?.("Scheduled Telegram delivery failed", {
			transport: "telegram",
			threadId,
			scheduleId: input.scheduleId,
			executionId: input.executionId,
			error,
		});
		await dispatchConnectorHook(
			input.hookCommand,
			{
				adapter: "telegram",
				botUserName: input.botUsername,
				event: "schedule.delivery.failed",
				payload: {
					threadId,
					scheduleId: input.scheduleId,
					executionId: input.executionId,
					error: error instanceof Error ? error.message : String(error),
				},
				ts: new Date().toISOString(),
			},
			input.logger,
		);
	}
}

async function handleUserTurn(
	thread: Thread<TelegramThreadState>,
	text: string,
	client: RpcSessionClient,
	baseStartRequest: RpcChatStartSessionRequest,
	explicitSystemPrompt: string | undefined,
	clientId: string,
	logger: CliLoggerAdapter,
	botUsername: string,
	requestStop: (reason: string) => void,
	bindingsPath: string,
	hookCommand?: string,
): Promise<void> {
	const input = text.trim();
	if (!input) {
		return;
	}

	const initialState = await loadThreadState(
		thread,
		bindingsPath,
		baseStartRequest,
	);
	persistThreadBinding(bindingsPath, thread, initialState);
	logger.core.info?.("Telegram message received", {
		transport: "telegram",
		threadId: thread.id,
		channelId: thread.channelId,
		isDM: thread.isDM,
		textLength: input.length,
		textPreview: truncateText(input),
	});
	await dispatchConnectorHook(
		hookCommand,
		{
			adapter: "telegram",
			botUserName: botUsername,
			event: "message.received",
			payload: {
				threadId: thread.id,
				channelId: thread.channelId,
				isDM: thread.isDM,
				textLength: input.length,
				textPreview: truncateText(input),
			},
			ts: new Date().toISOString(),
		},
		logger,
	);

	if (
		await maybeHandleChatCommand(input, {
			enabled: true,
			getState: async () => {
				const current = await loadThreadState(
					thread,
					bindingsPath,
					baseStartRequest,
				);
				return {
					enableTools: current.enableTools ?? baseStartRequest.enableTools,
					autoApproveTools:
						current.autoApproveTools ??
						baseStartRequest.autoApproveTools === true,
					cwd:
						current.cwd ||
						baseStartRequest.cwd ||
						baseStartRequest.workspaceRoot,
					workspaceRoot:
						current.workspaceRoot || baseStartRequest.workspaceRoot,
				};
			},
			setState: async (next: ChatCommandState) => {
				const currentState = await loadThreadState(
					thread,
					bindingsPath,
					baseStartRequest,
				);
				const systemPrompt = await resolveSystemPrompt({
					cwd: next.cwd,
					explicitSystemPrompt,
					providerId: baseStartRequest.provider,
					rules: TELEGRAM_SYSTEM_RULES,
				});
				const nextState: TelegramThreadState = {
					...currentState,
					enableTools: next.enableTools,
					autoApproveTools: next.autoApproveTools,
					cwd: next.cwd,
					workspaceRoot: next.workspaceRoot,
					systemPrompt,
				};
				const runtimeConfigChanged =
					(currentState.enableTools ?? baseStartRequest.enableTools) !==
						next.enableTools ||
					(currentState.autoApproveTools ??
						baseStartRequest.autoApproveTools === true) !==
						next.autoApproveTools ||
					(currentState.cwd || baseStartRequest.cwd) !== next.cwd ||
					(currentState.workspaceRoot || baseStartRequest.workspaceRoot) !==
						next.workspaceRoot ||
					(currentState.systemPrompt || baseStartRequest.systemPrompt) !==
						systemPrompt;
				if (runtimeConfigChanged && currentState.sessionId?.trim()) {
					await clearSession(thread, client, bindingsPath, baseStartRequest);
					nextState.sessionId = undefined;
				}
				await persistMergedThreadState(thread, bindingsPath, nextState);
			},
			reply: async (message) => {
				await thread.post(message);
			},
			reset: async () => {
				await clearSession(thread, client, bindingsPath, baseStartRequest);
				logger.core.info?.("Telegram thread reset", {
					transport: "telegram",
					threadId: thread.id,
				});
				await dispatchConnectorHook(
					hookCommand,
					{
						adapter: "telegram",
						botUserName: botUsername,
						event: "thread.reset",
						payload: { threadId: thread.id, channelId: thread.channelId },
						ts: new Date().toISOString(),
					},
					logger,
				);
			},
			stop: async () => {
				await clearSession(thread, client, bindingsPath, baseStartRequest);
				logger.core.warn?.("Telegram connector stop requested from chat", {
					transport: "telegram",
					threadId: thread.id,
				});
				requestStop("telegram_stop_command");
			},
			describe: async () => {
				const current = await loadThreadState(
					thread,
					bindingsPath,
					baseStartRequest,
				);
				return [
					`threadId=${thread.id}`,
					`channelId=${thread.channelId}`,
					`isDM=${thread.isDM ? "true" : "false"}`,
					`tools=${current.enableTools ? "on" : "off"}`,
					`yolo=${current.autoApproveTools ? "on" : "off"}`,
					`cwd=${current.cwd || baseStartRequest.cwd}`,
					`workspaceRoot=${current.workspaceRoot || baseStartRequest.workspaceRoot}`,
				].join("\n");
			},
		})
	) {
		return;
	}

	const currentState = await loadThreadState(
		thread,
		bindingsPath,
		baseStartRequest,
	);
	const startRequest = buildThreadStartRequest(baseStartRequest, currentState);

	const sessionId = await getOrCreateSessionId(
		thread,
		client,
		startRequest,
		logger,
		clientId,
		botUsername,
		bindingsPath,
		hookCommand,
	);
	const request: RpcChatRunTurnRequest = {
		config: startRequest,
		prompt: input,
	};

	logger.core.info?.("Telegram reply streaming started", {
		transport: "telegram",
		threadId: thread.id,
		sessionId,
		promptLength: input.length,
		promptPreview: truncateText(input),
	});
	await thread.startTyping();
	await thread.post(
		createRpcTurnStream({
			client,
			sessionId,
			request,
			clientId,
			logger,
			threadId: thread.id,
			botUsername,
			hookCommand,
		}),
	);
	await persistMergedThreadState(thread, bindingsPath, {
		...currentState,
		sessionId,
	});
}

async function runConnectTelegramCommand(
	rawArgs: string[],
	io: ConnectIo,
): Promise<number> {
	let options: ConnectTelegramOptions;
	try {
		options = parseConnectTelegramArgs(rawArgs);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message === "__SHOW_HELP__") {
			showConnectTelegramHelp(io);
			return 0;
		}
		io.writeErr(message);
		return 1;
	}

	const statePath = resolveConnectorStatePath(options.botUsername);
	const bindingsPath = resolveBindingsPath(options.botUsername);
	const existingState = readConnectorState(statePath);
	if (existingState && !isProcessRunning(existingState.pid)) {
		removeConnectorState(statePath);
	}
	if (
		!options.interactive &&
		process.env.CLINE_TELEGRAM_CONNECT_CHILD !== "1"
	) {
		const runningState = readConnectorState(statePath);
		if (runningState && isProcessRunning(runningState.pid)) {
			io.writeln(
				`[telegram] connector already running pid=${runningState.pid} rpc=${runningState.rpcAddress}`,
			);
			return 0;
		}
		const pid = spawnDetachedTelegramConnector(rawArgs);
		if (!pid) {
			io.writeErr("failed to launch Telegram connector in background");
			return 1;
		}
		io.writeln(
			`[telegram] starting background connector pid=${pid} bot=@${options.botUsername}`,
		);
		io.writeln(
			"[telegram] use `clite connect telegram -i ...` to run in the foreground",
		);
		return 0;
	}

	const loggerAdapter = createCliLoggerAdapter({
		runtime: "cli",
		component: "telegram-connect",
	});
	const logger = createChatSdkLogger(loggerAdapter);
	const consoleLogger = new ConsoleLogger("info", "telegram-connect");
	const telegram = createTelegramAdapter({
		mode: "polling",
		botToken: options.botToken,
		userName: options.botUsername,
		logger,
	});
	const bot = new Chat({
		userName: options.botUsername,
		adapters: { telegram },
		state: new InMemoryStateAdapter(),
		logger,
		fallbackStreamingPlaceholderText: null,
		streamingUpdateIntervalMs: 500,
	}).registerSingleton();
	const threadQueues = new Map<string, Promise<void>>();
	const startRequest = await buildTelegramStartRequest(options, io, {
		enabled: loggerAdapter.runtimeConfig.enabled,
		level: loggerAdapter.runtimeConfig.level,
		destination: loggerAdapter.runtimeConfig.destination,
		bindings: {
			transport: "telegram",
			botUserName: options.botUsername,
		},
	});
	const rpcAddress = await ensureRpcRuntimeAddress(options.rpcAddress);
	process.env.CLINE_RPC_ADDRESS = rpcAddress;

	const clientId = `telegram-${process.pid}-${Date.now()}`;
	await registerRpcClient(rpcAddress, {
		clientId,
		clientType: "cli",
		metadata: {
			transport: "telegram",
			botUserName: options.botUsername,
		},
	}).catch(() => undefined);

	const client = new RpcSessionClient({ address: rpcAddress });
	writeConnectorState(statePath, {
		botUsername: options.botUsername,
		pid: process.pid,
		rpcAddress,
		startedAt: new Date().toISOString(),
	});
	loggerAdapter.core.info?.("Telegram connector started", {
		transport: "telegram",
		botUserName: options.botUsername,
		pid: process.pid,
		rpcAddress,
		mode: telegram.runtimeMode,
		interactive: options.interactive,
	});
	await dispatchConnectorHook(
		options.hookCommand,
		{
			adapter: "telegram",
			botUserName: options.botUsername,
			event: "connector.started",
			payload: {
				pid: process.pid,
				rpcAddress,
				mode: telegram.runtimeMode,
			},
			ts: new Date().toISOString(),
		},
		loggerAdapter,
	);

	const handleTurn = async (
		thread: Thread<TelegramThreadState>,
		text: string,
	) => {
		await enqueueThreadTurn(threadQueues, thread.id, async () => {
			try {
				await handleUserTurn(
					thread,
					text,
					client,
					startRequest,
					options.systemPrompt?.trim() || undefined,
					clientId,
					loggerAdapter,
					options.botUsername,
					requestStop,
					bindingsPath,
					options.hookCommand,
				);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				loggerAdapter.core.error?.("Telegram turn handling failed", {
					transport: "telegram",
					threadId: thread.id,
					error,
				});
				await thread.post(`Telegram bridge error: ${message}`);
			}
		});
	};

	let stopping = false;
	let resolveStop: (() => void) | undefined;
	const stopPromise = new Promise<void>((resolve) => {
		resolveStop = resolve;
	});
	const requestStop = (reason: string) => {
		if (stopping) {
			return;
		}
		stopping = true;
		loggerAdapter.core.warn?.("Telegram connector stopping", {
			transport: "telegram",
			reason,
			pid: process.pid,
		});
		resolveStop?.();
	};

	bot.onNewMention(async (thread, message) => {
		await thread.subscribe();
		await handleTurn(thread, message.text);
	});

	bot.onSubscribedMessage(async (thread, message) => {
		await handleTurn(thread, message.text);
	});

	await bot.initialize();

	const stopEventStream = client.streamEvents(
		{ clientId: `${clientId}-server-events` },
		{
			onEvent: (event) => {
				if (event.eventType === "rpc.server.shutting_down") {
					loggerAdapter.core.warn?.(
						"Telegram connector stopping because the RPC server is shutting down",
						{
							transport: "telegram",
							eventType: event.eventType,
						},
					);
					requestStop("rpc_server_shutting_down");
					return;
				}
				if (event.eventType !== "schedule.execution.completed") {
					return;
				}
				const scheduleId =
					typeof event.payload.scheduleId === "string"
						? event.payload.scheduleId.trim()
						: "";
				const executionId =
					typeof event.payload.executionId === "string"
						? event.payload.executionId.trim()
						: "";
				const sessionId =
					typeof event.payload.sessionId === "string"
						? event.payload.sessionId.trim()
						: undefined;
				const status =
					typeof event.payload.status === "string"
						? event.payload.status.trim()
						: "";
				const errorMessage =
					typeof event.payload.errorMessage === "string"
						? event.payload.errorMessage
						: undefined;
				if (!scheduleId || !executionId || !status) {
					return;
				}
				void deliverScheduledResult({
					bot,
					client,
					logger: loggerAdapter,
					bindingsPath,
					botUsername: options.botUsername,
					scheduleId,
					executionId,
					sessionId,
					status,
					errorMessage,
					hookCommand: options.hookCommand,
				});
			},
			onError: (error) => {
				loggerAdapter.core.warn?.(
					"Telegram connector server event stream failed",
					{
						transport: "telegram",
						error,
					},
				);
				requestStop("rpc_server_event_stream_failed");
			},
		},
	);

	consoleLogger.info("Telegram connector ready", {
		rpcAddress,
		mode: telegram.runtimeMode,
	});
	io.writeln(
		`[telegram] connected as @${options.botUsername} mode=${telegram.runtimeMode} rpc=${rpcAddress} provider=${startRequest.provider} model=${startRequest.model} tools=${startRequest.enableTools ? "on" : "off"}`,
	);
	io.writeln("[telegram] send /reset in a chat to start a fresh RPC session");
	io.writeln(
		"[telegram] send /whereami in a chat to get its delivery thread id",
	);
	io.writeln(
		"[telegram] use /tools, /yolo, or /cwd <path> to update runtime settings",
	);
	io.writeln("[telegram] send /stop in a chat or press Ctrl+C to stop");

	const shutdown = () => {
		process.off("SIGINT", shutdown);
		process.off("SIGTERM", shutdown);
		requestStop("signal");
	};
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);

	await stopPromise;

	stopEventStream();
	await dispatchConnectorHook(
		options.hookCommand,
		{
			adapter: "telegram",
			botUserName: options.botUsername,
			event: "connector.stopping",
			payload: { pid: process.pid },
			ts: new Date().toISOString(),
		},
		loggerAdapter,
	);
	await telegram.stopPolling().catch(() => undefined);
	await bot.shutdown().catch(() => undefined);
	client.close();
	removeConnectorState(statePath);
	loggerAdapter.core.info?.("Telegram connector stopped", {
		transport: "telegram",
		pid: process.pid,
	});
	return 0;
}

export const telegramConnector: ConnectCommandDefinition = {
	name: "telegram",
	description: "Bridge Telegram bot messages into RPC chat sessions",
	run: runConnectTelegramCommand,
	showHelp: showConnectTelegramHelp,
	stopAll: async (io) => {
		const statePaths = listConnectorStatePaths();
		let stoppedProcesses = 0;
		let stoppedSessions = 0;
		for (const statePath of statePaths) {
			const result = await stopTelegramConnectorInstance(statePath, io);
			stoppedProcesses += result.stoppedProcesses;
			stoppedSessions += result.stoppedSessions;
		}
		return { stoppedProcesses, stoppedSessions };
	},
};
