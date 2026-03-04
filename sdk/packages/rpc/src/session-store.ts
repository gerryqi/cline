import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";

export type RpcSessionStatus = "running" | "completed" | "failed" | "cancelled";

export interface RpcSessionRow {
	sessionId: string;
	source: string;
	pid: number;
	startedAt: string;
	endedAt?: string | null;
	exitCode?: number | null;
	status: RpcSessionStatus;
	statusLock: number;
	interactive: boolean;
	provider: string;
	model: string;
	cwd: string;
	workspaceRoot: string;
	teamName?: string;
	enableTools: boolean;
	enableSpawn: boolean;
	enableTeams: boolean;
	parentSessionId?: string;
	parentAgentId?: string;
	agentId?: string;
	conversationId?: string;
	isSubagent: boolean;
	prompt?: string;
	transcriptPath: string;
	hookPath: string;
	messagesPath?: string;
	updatedAt: string;
}

export interface RpcSpawnQueueItem {
	id: number;
	rootSessionId: string;
	parentAgentId: string;
	task?: string;
	systemPrompt?: string;
	createdAt: string;
	consumedAt?: string;
}

type SqliteStatement = {
	run: (...params: unknown[]) => { changes?: number };
	get: (...params: unknown[]) => Record<string, unknown> | null;
	all: (...params: unknown[]) => Record<string, unknown>[];
};

type SqliteDb = {
	prepare: (sql: string) => SqliteStatement;
	exec: (sql: string) => void;
};

type BunSqliteDb = {
	query: (sql: string) => {
		run: (...params: unknown[]) => { changes?: number };
		get: (...params: unknown[]) => Record<string, unknown> | null;
		all: (...params: unknown[]) => Record<string, unknown>[];
	};
	exec: (sql: string) => void;
};

function nowIso(): string {
	return new Date().toISOString();
}

function asString(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function asOptionalString(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function asBool(value: unknown): boolean {
	return value === 1 || value === true;
}

function resolveSessionDataDir(): string {
	const explicitDir = process.env.CLINE_SESSION_DATA_DIR?.trim();
	if (explicitDir) {
		return explicitDir;
	}
	const explicitDataDir = process.env.CLINE_DATA_DIR?.trim();
	if (explicitDataDir) {
		return join(explicitDataDir, "sessions");
	}
	return join(homedir(), ".cline", "data", "sessions");
}

function loadDb(filePath: string): SqliteDb {
	const require = createRequire(import.meta.url);
	const isBunRuntime =
		typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";

	if (isBunRuntime) {
		const { Database } = require("bun:sqlite") as {
			Database: new (
				path: string,
				options?: { create?: boolean; strict?: boolean },
			) => BunSqliteDb;
		};
		const db = new Database(filePath, { create: true });
		return {
			prepare: (sql: string): SqliteStatement => {
				const query = db.query(sql);
				return {
					run: (...params: unknown[]) => query.run(...params),
					get: (...params: unknown[]) => query.get(...params),
					all: (...params: unknown[]) => query.all(...params),
				};
			},
			exec: (sql: string) => db.exec(sql),
		};
	}

	const BetterSqlite3 = require("better-sqlite3") as new (
		path: string,
	) => SqliteDb;
	return new BetterSqlite3(filePath);
}

export interface RpcSessionStoreOptions {
	sessionsDir?: string;
}

export class RpcSessionStore {
	private readonly sessionsDirPath: string;
	private db: SqliteDb | undefined;

	constructor(options: RpcSessionStoreOptions = {}) {
		this.sessionsDirPath = options.sessionsDir ?? resolveSessionDataDir();
	}

	public ensureSessionsDir(): string {
		if (!existsSync(this.sessionsDirPath)) {
			mkdirSync(this.sessionsDirPath, { recursive: true });
		}
		return this.sessionsDirPath;
	}

	public init(): void {
		void this.getRawDb();
	}

	private sessionDbPath(): string {
		return join(this.ensureSessionsDir(), "sessions.db");
	}

	private getRawDb(): SqliteDb {
		if (this.db) {
			return this.db;
		}
		const db = loadDb(this.sessionDbPath());
		db.exec("PRAGMA journal_mode = WAL;");
		db.exec("PRAGMA busy_timeout = 5000;");
		db.exec(`
			CREATE TABLE IF NOT EXISTS sessions (
				session_id TEXT PRIMARY KEY,
				source TEXT NOT NULL,
				pid INTEGER NOT NULL,
				started_at TEXT NOT NULL,
				ended_at TEXT,
				exit_code INTEGER,
				status TEXT NOT NULL,
				status_lock INTEGER NOT NULL DEFAULT 0,
				interactive INTEGER NOT NULL,
				provider TEXT NOT NULL,
				model TEXT NOT NULL,
				cwd TEXT NOT NULL,
				workspace_root TEXT NOT NULL,
				team_name TEXT,
				enable_tools INTEGER NOT NULL,
				enable_spawn INTEGER NOT NULL,
				enable_teams INTEGER NOT NULL,
				parent_session_id TEXT,
				parent_agent_id TEXT,
				agent_id TEXT,
				conversation_id TEXT,
				is_subagent INTEGER NOT NULL DEFAULT 0,
				prompt TEXT,
				transcript_path TEXT NOT NULL,
				hook_path TEXT NOT NULL,
				messages_path TEXT,
				updated_at TEXT NOT NULL
			);
		`);
		db.exec(`
			CREATE TABLE IF NOT EXISTS subagent_spawn_queue (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				root_session_id TEXT NOT NULL,
				parent_agent_id TEXT NOT NULL,
				task TEXT,
				system_prompt TEXT,
				created_at TEXT NOT NULL,
				consumed_at TEXT
			);
		`);
		this.db = db;
		return db;
	}

	private run(sql: string, params: unknown[] = []): { changes?: number } {
		return this.getRawDb()
			.prepare(sql)
			.run(...params);
	}

	private queryOne<T>(sql: string, params: unknown[] = []): T | undefined {
		const row = this.getRawDb()
			.prepare(sql)
			.get(...params);
		return (row as T | null) ?? undefined;
	}

	private queryAll<T>(sql: string, params: unknown[] = []): T[] {
		return this.getRawDb()
			.prepare(sql)
			.all(...params) as T[];
	}

	public upsertSession(row: RpcSessionRow): void {
		this.run(
			`INSERT OR REPLACE INTO sessions (
				session_id, source, pid, started_at, ended_at, exit_code, status, status_lock, interactive,
				provider, model, cwd, workspace_root, team_name, enable_tools, enable_spawn, enable_teams,
				parent_session_id, parent_agent_id, agent_id, conversation_id, is_subagent, prompt,
				transcript_path, hook_path, messages_path, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				row.sessionId,
				row.source,
				row.pid,
				row.startedAt,
				row.endedAt ?? null,
				row.exitCode ?? null,
				row.status,
				row.statusLock,
				row.interactive ? 1 : 0,
				row.provider,
				row.model,
				row.cwd,
				row.workspaceRoot,
				row.teamName ?? null,
				row.enableTools ? 1 : 0,
				row.enableSpawn ? 1 : 0,
				row.enableTeams ? 1 : 0,
				row.parentSessionId ?? null,
				row.parentAgentId ?? null,
				row.agentId ?? null,
				row.conversationId ?? null,
				row.isSubagent ? 1 : 0,
				row.prompt ?? null,
				row.transcriptPath,
				row.hookPath,
				row.messagesPath ?? null,
				row.updatedAt || nowIso(),
			],
		);
	}

	public getSession(sessionId: string): RpcSessionRow | undefined {
		const row = this.queryOne<Record<string, unknown>>(
			`SELECT session_id, source, pid, started_at, ended_at, exit_code, status, status_lock, interactive,
				provider, model, cwd, workspace_root, team_name, enable_tools, enable_spawn, enable_teams,
				parent_session_id, parent_agent_id, agent_id, conversation_id, is_subagent, prompt,
				transcript_path, hook_path, messages_path, updated_at
			 FROM sessions WHERE session_id = ?`,
			[sessionId],
		);
		if (!row) {
			return undefined;
		}
		return {
			sessionId: asString(row.session_id),
			source: asString(row.source),
			pid: Number(row.pid ?? 0),
			startedAt: asString(row.started_at),
			endedAt: (row.ended_at as string | null | undefined) ?? null,
			exitCode: (row.exit_code as number | null | undefined) ?? null,
			status: asString(row.status) as RpcSessionStatus,
			statusLock: Number(row.status_lock ?? 0),
			interactive: asBool(row.interactive),
			provider: asString(row.provider),
			model: asString(row.model),
			cwd: asString(row.cwd),
			workspaceRoot: asString(row.workspace_root),
			teamName: asOptionalString(row.team_name),
			enableTools: asBool(row.enable_tools),
			enableSpawn: asBool(row.enable_spawn),
			enableTeams: asBool(row.enable_teams),
			parentSessionId: asOptionalString(row.parent_session_id),
			parentAgentId: asOptionalString(row.parent_agent_id),
			agentId: asOptionalString(row.agent_id),
			conversationId: asOptionalString(row.conversation_id),
			isSubagent: asBool(row.is_subagent),
			prompt: asOptionalString(row.prompt),
			transcriptPath: asString(row.transcript_path),
			hookPath: asString(row.hook_path),
			messagesPath: asOptionalString(row.messages_path),
			updatedAt: asString(row.updated_at) || nowIso(),
		};
	}

	public listSessions(options: {
		limit: number;
		parentSessionId?: string;
		status?: string;
	}): RpcSessionRow[] {
		const where: string[] = [];
		const params: unknown[] = [];
		if (options.parentSessionId) {
			where.push("parent_session_id = ?");
			params.push(options.parentSessionId);
		}
		if (options.status) {
			where.push("status = ?");
			params.push(options.status);
		}
		const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
		const limit = Math.max(1, Math.floor(options.limit));
		const rows = this.queryAll<{ session_id?: string }>(
			`SELECT session_id FROM sessions ${whereClause} ORDER BY started_at DESC LIMIT ?`,
			[...params, limit],
		);
		const out: RpcSessionRow[] = [];
		for (const row of rows) {
			if (!row.session_id) {
				continue;
			}
			const item = this.getSession(row.session_id);
			if (item) {
				out.push(item);
			}
		}
		return out;
	}

	public updateSession(input: {
		sessionId: string;
		status?: RpcSessionStatus;
		endedAt?: string | null;
		exitCode?: number | null;
		prompt?: string | null;
		parentSessionId?: string | null;
		parentAgentId?: string | null;
		agentId?: string | null;
		conversationId?: string | null;
		expectedStatusLock?: number;
		setRunning?: boolean;
	}): { updated: boolean; statusLock: number } {
		const existing = this.getSession(input.sessionId);
		if (!existing) {
			return { updated: false, statusLock: 0 };
		}
		if (
			typeof input.expectedStatusLock === "number" &&
			existing.statusLock !== input.expectedStatusLock
		) {
			return { updated: false, statusLock: existing.statusLock };
		}
		const nextLock = existing.statusLock + 1;
		const nextStatus = input.setRunning
			? "running"
			: (input.status ?? existing.status);
		const nextEndedAt =
			input.setRunning === true
				? null
				: input.endedAt !== undefined
					? input.endedAt
					: (existing.endedAt ?? null);
		const nextExitCode =
			input.setRunning === true
				? null
				: input.exitCode !== undefined
					? input.exitCode
					: (existing.exitCode ?? null);
		const nextPrompt =
			input.prompt !== undefined
				? (input.prompt ?? undefined)
				: existing.prompt;
		this.run(
			`UPDATE sessions
			 SET status = ?, ended_at = ?, exit_code = ?, prompt = ?,
				 parent_session_id = ?, parent_agent_id = ?, agent_id = ?, conversation_id = ?,
				 status_lock = ?, updated_at = ?
			 WHERE session_id = ?`,
			[
				nextStatus,
				nextEndedAt,
				nextExitCode,
				nextPrompt ?? null,
				input.parentSessionId !== undefined
					? (input.parentSessionId ?? null)
					: (existing.parentSessionId ?? null),
				input.parentAgentId !== undefined
					? (input.parentAgentId ?? null)
					: (existing.parentAgentId ?? null),
				input.agentId !== undefined
					? (input.agentId ?? null)
					: (existing.agentId ?? null),
				input.conversationId !== undefined
					? (input.conversationId ?? null)
					: (existing.conversationId ?? null),
				nextLock,
				nowIso(),
				input.sessionId,
			],
		);
		return { updated: true, statusLock: nextLock };
	}

	public deleteSession(sessionId: string): boolean {
		const changes =
			this.run("DELETE FROM sessions WHERE session_id = ?", [sessionId])
				.changes ?? 0;
		return changes > 0;
	}

	public deleteSessionsByParent(parentSessionId: string): void {
		this.run("DELETE FROM sessions WHERE parent_session_id = ?", [
			parentSessionId,
		]);
	}

	public enqueueSpawnRequest(input: {
		rootSessionId: string;
		parentAgentId: string;
		task?: string;
		systemPrompt?: string;
	}): void {
		this.run(
			`INSERT INTO subagent_spawn_queue (root_session_id, parent_agent_id, task, system_prompt, created_at, consumed_at)
			 VALUES (?, ?, ?, ?, ?, NULL)`,
			[
				input.rootSessionId,
				input.parentAgentId,
				input.task ?? null,
				input.systemPrompt ?? null,
				nowIso(),
			],
		);
	}

	public claimSpawnRequest(
		rootSessionId: string,
		parentAgentId: string,
	): RpcSpawnQueueItem | undefined {
		const row = this.queryOne<Record<string, unknown>>(
			`SELECT id, root_session_id, parent_agent_id, task, system_prompt, created_at, consumed_at
			 FROM subagent_spawn_queue
			 WHERE root_session_id = ? AND parent_agent_id = ? AND consumed_at IS NULL
			 ORDER BY id ASC LIMIT 1`,
			[rootSessionId, parentAgentId],
		);
		if (!row || typeof row.id !== "number") {
			return undefined;
		}
		const consumedAt = nowIso();
		this.run("UPDATE subagent_spawn_queue SET consumed_at = ? WHERE id = ?", [
			consumedAt,
			row.id,
		]);
		return {
			id: row.id,
			rootSessionId: asString(row.root_session_id),
			parentAgentId: asString(row.parent_agent_id),
			task: asOptionalString(row.task),
			systemPrompt: asOptionalString(row.system_prompt),
			createdAt: asString(row.created_at),
			consumedAt,
		};
	}
}
