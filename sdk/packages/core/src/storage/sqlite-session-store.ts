import { existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { SessionStatus } from "../types/common";
import type { SessionRecord } from "../types/sessions";
import type { SessionStore } from "../types/storage";
import { resolveSessionDataDir } from "./paths";

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

function defaultSessionsDir(): string {
	return resolveSessionDataDir();
}

function toBoolInt(value: boolean): number {
	return value ? 1 : 0;
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

export interface SqliteSessionStoreOptions {
	sessionsDir?: string;
}

export class SqliteSessionStore implements SessionStore {
	private readonly sessionsDirPath: string;
	private db: SqliteDb | undefined;

	constructor(options: SqliteSessionStoreOptions = {}) {
		this.sessionsDirPath = options.sessionsDir ?? defaultSessionsDir();
	}

	init(): void {
		this.getRawDb();
	}

	ensureSessionsDir(): string {
		if (!existsSync(this.sessionsDirPath)) {
			mkdirSync(this.sessionsDirPath, { recursive: true });
		}
		return this.sessionsDirPath;
	}

	sessionDbPath(): string {
		return join(this.ensureSessionsDir(), "sessions.db");
	}

	getRawDb(): SqliteDb {
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

		const columns = db.prepare("PRAGMA table_info(sessions);").all();
		const hasColumn = (name: string): boolean =>
			columns.some((column) => column.name === name);
		if (!hasColumn("workspace_root")) {
			db.exec("ALTER TABLE sessions ADD COLUMN workspace_root TEXT;");
			db.exec(
				"UPDATE sessions SET workspace_root = cwd WHERE workspace_root IS NULL OR workspace_root = '';",
			);
		}
		if (!hasColumn("parent_session_id")) {
			db.exec("ALTER TABLE sessions ADD COLUMN parent_session_id TEXT;");
		}
		if (!hasColumn("parent_agent_id")) {
			db.exec("ALTER TABLE sessions ADD COLUMN parent_agent_id TEXT;");
		}
		if (!hasColumn("agent_id")) {
			db.exec("ALTER TABLE sessions ADD COLUMN agent_id TEXT;");
		}
		if (!hasColumn("conversation_id")) {
			db.exec("ALTER TABLE sessions ADD COLUMN conversation_id TEXT;");
		}
		if (!hasColumn("is_subagent")) {
			db.exec(
				"ALTER TABLE sessions ADD COLUMN is_subagent INTEGER NOT NULL DEFAULT 0;",
			);
		}
		if (!hasColumn("messages_path")) {
			db.exec("ALTER TABLE sessions ADD COLUMN messages_path TEXT;");
		}

		this.db = db;
		return db;
	}

	run(sql: string, params: unknown[] = []): { changes?: number } {
		return this.getRawDb()
			.prepare(sql)
			.run(...params);
	}

	queryOne<T>(sql: string, params: unknown[] = []): T | undefined {
		const row = this.getRawDb()
			.prepare(sql)
			.get(...params);
		return (row as T | null) ?? undefined;
	}

	queryAll<T>(sql: string, params: unknown[] = []): T[] {
		return this.getRawDb()
			.prepare(sql)
			.all(...params) as T[];
	}

	create(record: SessionRecord): void {
		const now = nowIso();
		this.run(
			`INSERT OR REPLACE INTO sessions (
				session_id, source, pid, started_at, ended_at, exit_code, status, status_lock, interactive,
				provider, model, cwd, workspace_root, team_name, enable_tools, enable_spawn, enable_teams,
				parent_session_id, parent_agent_id, agent_id, conversation_id, is_subagent, prompt,
				transcript_path, hook_path, messages_path, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				record.sessionId,
				record.source,
				record.pid,
				record.startedAt,
				record.endedAt ?? null,
				record.exitCode ?? null,
				record.status,
				0,
				toBoolInt(record.interactive),
				record.provider,
				record.model,
				record.cwd,
				record.workspaceRoot,
				record.teamName ?? null,
				toBoolInt(record.enableTools),
				toBoolInt(record.enableSpawn),
				toBoolInt(record.enableTeams),
				record.parentSessionId ?? null,
				record.parentAgentId ?? null,
				record.agentId ?? null,
				record.conversationId ?? null,
				toBoolInt(record.isSubagent),
				record.prompt ?? null,
				record.transcriptPath ?? "",
				record.hookPath ?? "",
				record.messagesPath ?? null,
				now,
			],
		);
	}

	update(record: Partial<SessionRecord> & { sessionId: string }): void {
		const fields: string[] = [];
		const params: unknown[] = [];
		if (record.endedAt !== undefined) {
			fields.push("ended_at = ?");
			params.push(record.endedAt);
		}
		if (record.exitCode !== undefined) {
			fields.push("exit_code = ?");
			params.push(record.exitCode);
		}
		if (record.status !== undefined) {
			fields.push("status = ?");
			params.push(record.status);
		}
		if (record.prompt !== undefined) {
			fields.push("prompt = ?");
			params.push(record.prompt);
		}
		if (record.parentSessionId !== undefined) {
			fields.push("parent_session_id = ?");
			params.push(record.parentSessionId);
		}
		if (record.parentAgentId !== undefined) {
			fields.push("parent_agent_id = ?");
			params.push(record.parentAgentId);
		}
		if (record.agentId !== undefined) {
			fields.push("agent_id = ?");
			params.push(record.agentId);
		}
		if (record.conversationId !== undefined) {
			fields.push("conversation_id = ?");
			params.push(record.conversationId);
		}
		if (fields.length === 0) {
			return;
		}
		fields.push("updated_at = ?");
		params.push(nowIso());
		params.push(record.sessionId);
		this.run(
			`UPDATE sessions SET ${fields.join(", ")} WHERE session_id = ?`,
			params,
		);
	}

	updateStatus(
		sessionId: string,
		status: SessionStatus,
		exitCode?: number | null,
	): void {
		this.update({
			sessionId,
			status,
			endedAt: status === "running" ? null : nowIso(),
			exitCode:
				status === "running"
					? null
					: (exitCode ?? (status === "failed" ? 1 : 0)),
		});
	}

	get(sessionId: string): SessionRecord | undefined {
		const row = this.queryOne<Record<string, unknown>>(
			`SELECT session_id, source, pid, started_at, ended_at, exit_code, status, interactive,
				provider, model, cwd, workspace_root, team_name,
				enable_tools, enable_spawn, enable_teams,
				parent_session_id, parent_agent_id, agent_id, conversation_id, is_subagent,
				prompt, transcript_path, hook_path, messages_path, updated_at
			 FROM sessions WHERE session_id = ?`,
			[sessionId],
		);
		if (!row) {
			return undefined;
		}
		return {
			sessionId: asString(row.session_id),
			source: asString(row.source) as SessionRecord["source"],
			pid: Number(row.pid ?? 0),
			startedAt: asString(row.started_at),
			endedAt: (row.ended_at as string | null | undefined) ?? null,
			exitCode: (row.exit_code as number | null | undefined) ?? null,
			status: asString(row.status) as SessionRecord["status"],
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
			transcriptPath: asOptionalString(row.transcript_path),
			hookPath: asOptionalString(row.hook_path),
			messagesPath: asOptionalString(row.messages_path),
			updatedAt: asOptionalString(row.updated_at) ?? nowIso(),
		};
	}

	list(limit = 200): SessionRecord[] {
		const rows = this.queryAll<Record<string, unknown>>(
			`SELECT session_id FROM sessions ORDER BY started_at DESC LIMIT ?`,
			[limit],
		);
		const result: SessionRecord[] = [];
		for (const row of rows) {
			const item = this.get(asString(row.session_id));
			if (item) {
				result.push(item);
			}
		}
		return result;
	}

	delete(sessionId: string, cascade = false): boolean {
		const changed =
			this.run(`DELETE FROM sessions WHERE session_id = ?`, [sessionId])
				.changes ?? 0;
		if (cascade) {
			this.run(`DELETE FROM sessions WHERE parent_session_id = ?`, [sessionId]);
		}
		return changed > 0;
	}
}
