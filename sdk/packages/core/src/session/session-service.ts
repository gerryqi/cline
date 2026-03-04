import {
	appendFileSync,
	existsSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import type {
	HookEventPayload,
	SubAgentEndContext,
	SubAgentStartContext,
} from "@cline/agents";
import type { providers as LlmsProviders } from "@cline/llms";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { SqliteSessionStore } from "../storage/sqlite-session-store";
import { SessionSource, type SessionStatus } from "../types/common";
import {
	getRootSessionIdFromEnv,
	nowIso,
	SessionArtifacts,
	unlinkIfExists,
} from "./session-artifacts";
import {
	deriveSubsessionStatus,
	makeSubSessionId,
	makeTeamTaskSubSessionId,
} from "./session-graph";
import {
	type SessionManifest,
	SessionManifestSchema,
} from "./session-manifest";

export interface SessionRowShape {
	session_id: string;
	source: string;
	pid: number;
	started_at: string;
	ended_at?: string | null;
	exit_code?: number | null;
	status: SessionStatus;
	status_lock?: number;
	interactive: number;
	provider: string;
	model: string;
	cwd: string;
	workspace_root: string;
	team_name?: string | null;
	enable_tools: number;
	enable_spawn: number;
	enable_teams: number;
	parent_session_id?: string | null;
	parent_agent_id?: string | null;
	agent_id?: string | null;
	conversation_id?: string | null;
	is_subagent: number;
	prompt?: string | null;
	transcript_path: string;
	hook_path: string;
	messages_path?: string | null;
	updated_at?: string;
}

export interface CreateRootSessionInput {
	sessionId: string;
	source: SessionSource;
	pid: number;
	startedAt: string;
	interactive: boolean;
	provider: string;
	model: string;
	cwd: string;
	workspaceRoot: string;
	teamName?: string;
	enableTools: boolean;
	enableSpawn: boolean;
	enableTeams: boolean;
	prompt?: string;
	transcriptPath: string;
	hookPath: string;
	messagesPath: string;
}

export interface CreateRootSessionWithArtifactsInput {
	sessionId: string;
	source: SessionSource;
	pid: number;
	interactive: boolean;
	provider: string;
	model: string;
	cwd: string;
	workspaceRoot: string;
	teamName?: string;
	enableTools: boolean;
	enableSpawn: boolean;
	enableTeams: boolean;
	prompt?: string;
	startedAt?: string;
}

export interface RootSessionArtifacts {
	manifestPath: string;
	transcriptPath: string;
	hookPath: string;
	messagesPath: string;
	manifest: SessionManifest;
	env: {
		CLINE_SESSION_ID: string;
		CLINE_HOOKS_LOG_PATH: string;
		CLINE_ENABLE_SUBPROCESS_HOOKS: "1";
	};
}

export interface UpsertSubagentInput {
	agentId: string;
	parentAgentId: string;
	conversationId: string;
	prompt?: string;
	rootSessionId?: string;
}

const SUBSESSION_SOURCE = SessionSource.CLI_SUBAGENT;
const SpawnAgentInputSchema = z
	.object({
		task: z.string().optional(),
		systemPrompt: z.string().optional(),
	})
	.passthrough();

export class CoreSessionService {
	private readonly teamTaskSessionsByAgent = new Map<string, string[]>();
	private readonly artifacts: SessionArtifacts;

	constructor(private readonly store: SqliteSessionStore) {
		this.artifacts = new SessionArtifacts(() => this.ensureSessionsDir());
	}

	ensureSessionsDir(): string {
		return this.store.ensureSessionsDir();
	}

	private sessionTranscriptPath(sessionId: string): string {
		return this.artifacts.sessionTranscriptPath(sessionId);
	}

	private sessionHookPath(sessionId: string): string {
		return this.artifacts.sessionHookPath(sessionId);
	}

	private sessionMessagesPath(sessionId: string): string {
		return this.artifacts.sessionMessagesPath(sessionId);
	}

	private sessionManifestPath(sessionId: string, ensureDir = true): string {
		return this.artifacts.sessionManifestPath(sessionId, ensureDir);
	}

	private sessionPathFromStore(
		sessionId: string,
		kind: "transcript_path" | "hook_path" | "messages_path",
	): string | undefined {
		const row = this.store.queryOne<{
			transcript_path?: string | null;
			hook_path?: string | null;
			messages_path?: string | null;
		}>(
			`SELECT transcript_path, hook_path, messages_path FROM sessions WHERE session_id = ?`,
			[sessionId],
		);
		const value = row?.[kind];
		return typeof value === "string" && value.trim().length > 0
			? value
			: undefined;
	}

	private activeTeamTaskSessionId(parentAgentId: string): string | undefined {
		const queue = this.teamTaskSessionsByAgent.get(parentAgentId);
		if (!queue || queue.length === 0) {
			return undefined;
		}
		return queue[queue.length - 1];
	}

	private subagentArtifactPaths(
		sessionId: string,
		parentAgentId: string,
		subAgentId: string,
	): {
		transcriptPath: string;
		hookPath: string;
		messagesPath: string;
	} {
		return this.artifacts.subagentArtifactPaths(
			sessionId,
			subAgentId,
			this.activeTeamTaskSessionId(parentAgentId),
		);
	}

	private writeSessionManifestFile(
		manifestPath: string,
		manifest: SessionManifest,
	): void {
		const parsedManifest = SessionManifestSchema.parse(manifest);
		writeFileSync(
			manifestPath,
			`${JSON.stringify(parsedManifest, null, 2)}\n`,
			"utf8",
		);
	}

	private createRootSessionId(_source: SessionSource): string {
		return `${Date.now()}_${nanoid(5)}`;
	}

	createRootSessionWithArtifacts(
		input: CreateRootSessionWithArtifactsInput,
	): RootSessionArtifacts {
		const startedAt = input.startedAt ?? nowIso();
		const providedSessionId = input.sessionId.trim();
		const sessionId =
			providedSessionId.length > 0
				? providedSessionId
				: this.createRootSessionId(input.source);
		const transcriptPath = this.sessionTranscriptPath(sessionId);
		const hookPath = this.sessionHookPath(sessionId);
		const messagesPath = this.sessionMessagesPath(sessionId);
		const manifestPath = this.sessionManifestPath(sessionId);
		const manifest = SessionManifestSchema.parse({
			version: 1,
			session_id: sessionId,
			source: input.source,
			pid: input.pid,
			started_at: startedAt,
			status: "running",
			interactive: input.interactive,
			provider: input.provider,
			model: input.model,
			cwd: input.cwd,
			workspace_root: input.workspaceRoot,
			team_name: input.teamName,
			enable_tools: input.enableTools,
			enable_spawn: input.enableSpawn,
			enable_teams: input.enableTeams,
			prompt: input.prompt?.trim() || undefined,
			messages_path: messagesPath,
		});
		this.createRootSession({
			sessionId,
			source: input.source,
			pid: input.pid,
			startedAt,
			interactive: input.interactive,
			provider: input.provider,
			model: input.model,
			cwd: input.cwd,
			workspaceRoot: input.workspaceRoot,
			teamName: input.teamName,
			enableTools: input.enableTools,
			enableSpawn: input.enableSpawn,
			enableTeams: input.enableTeams,
			prompt: manifest.prompt,
			transcriptPath,
			hookPath,
			messagesPath,
		});
		writeFileSync(
			messagesPath,
			`${JSON.stringify({ version: 1, updated_at: startedAt, messages: [] }, null, 2)}\n`,
			"utf8",
		);
		this.writeSessionManifestFile(manifestPath, manifest);
		return {
			manifestPath,
			transcriptPath,
			hookPath,
			messagesPath,
			manifest,
			env: {
				CLINE_SESSION_ID: sessionId,
				CLINE_HOOKS_LOG_PATH: hookPath,
				CLINE_ENABLE_SUBPROCESS_HOOKS: "1",
			},
		};
	}

	writeSessionManifest(manifestPath: string, manifest: SessionManifest): void {
		this.writeSessionManifestFile(manifestPath, manifest);
	}

	createRootSession(input: CreateRootSessionInput): void {
		this.store.run(
			`INSERT OR REPLACE INTO sessions (
				session_id, source, pid, started_at, ended_at, exit_code, status, status_lock, interactive,
				provider, model, cwd, workspace_root, team_name, enable_tools, enable_spawn, enable_teams,
				parent_session_id, parent_agent_id, agent_id, conversation_id, is_subagent, prompt,
				transcript_path, hook_path, messages_path, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				input.sessionId,
				input.source,
				input.pid,
				input.startedAt,
				null,
				null,
				"running",
				0,
				input.interactive ? 1 : 0,
				input.provider,
				input.model,
				input.cwd,
				input.workspaceRoot,
				input.teamName ?? null,
				input.enableTools ? 1 : 0,
				input.enableSpawn ? 1 : 0,
				input.enableTeams ? 1 : 0,
				null,
				null,
				null,
				null,
				0,
				input.prompt ?? null,
				input.transcriptPath,
				input.hookPath,
				input.messagesPath,
				nowIso(),
			],
		);
	}

	updateSessionStatus(
		sessionId: string,
		status: SessionStatus,
		exitCode?: number | null,
	): { updated: boolean; endedAt?: string } {
		for (let attempt = 0; attempt < 4; attempt++) {
			const row = this.store.queryOne<{ status_lock?: number }>(
				`SELECT status_lock FROM sessions WHERE session_id = ?`,
				[sessionId],
			);
			if (!row || typeof row.status_lock !== "number") {
				return { updated: false };
			}
			const endedAt = nowIso();
			const changed = this.store.run(
				`UPDATE sessions
				 SET status = ?, ended_at = ?, exit_code = ?, status_lock = ?, updated_at = ?
				 WHERE session_id = ? AND status_lock = ?`,
				[
					status,
					endedAt,
					typeof exitCode === "number" ? exitCode : null,
					row.status_lock + 1,
					endedAt,
					sessionId,
					row.status_lock,
				],
			);
			if ((changed.changes ?? 0) > 0) {
				if (status === "cancelled") {
					this.applyStatusToRunningChildSessions(sessionId, "cancelled");
				}
				return { updated: true, endedAt };
			}
		}
		return { updated: false };
	}

	queueSpawnRequest(event: HookEventPayload): void {
		if (event.hookName !== "tool_call" || event.parent_agent_id !== null) {
			return;
		}
		if (event.tool_call?.name !== "spawn_agent") {
			return;
		}
		const rootSessionId = getRootSessionIdFromEnv();
		if (!rootSessionId) {
			return;
		}
		const parsedInput = SpawnAgentInputSchema.safeParse(event.tool_call.input);
		const task = parsedInput.success ? parsedInput.data.task : undefined;
		const systemPrompt = parsedInput.success
			? parsedInput.data.systemPrompt
			: undefined;
		this.store.run(
			`INSERT INTO subagent_spawn_queue (root_session_id, parent_agent_id, task, system_prompt, created_at, consumed_at)
			 VALUES (?, ?, ?, ?, ?, NULL)`,
			[
				rootSessionId,
				event.agent_id,
				task ?? null,
				systemPrompt ?? null,
				nowIso(),
			],
		);
	}

	private readRootSession(rootSessionId: string): SessionRowShape | null {
		const row = this.store.queryOne<SessionRowShape>(
			`SELECT session_id, provider, model, cwd, workspace_root, team_name, enable_tools, enable_spawn, enable_teams
			 FROM sessions WHERE session_id = ?`,
			[rootSessionId],
		);
		return row ?? null;
	}

	private claimQueuedSpawnTask(
		rootSessionId: string,
		parentAgentId: string,
	): string | undefined {
		const row = this.store.queryOne<{ id?: number; task?: string | null }>(
			`SELECT id, task FROM subagent_spawn_queue
			 WHERE root_session_id = ? AND parent_agent_id = ? AND consumed_at IS NULL
			 ORDER BY id ASC LIMIT 1`,
			[rootSessionId, parentAgentId],
		);
		if (!row || typeof row.id !== "number") {
			return undefined;
		}
		this.store.run(
			`UPDATE subagent_spawn_queue SET consumed_at = ? WHERE id = ?`,
			[nowIso(), row.id],
		);
		return row.task ?? undefined;
	}

	upsertSubagentSession(input: UpsertSubagentInput): string | undefined {
		const rootSessionId = input.rootSessionId ?? getRootSessionIdFromEnv();
		if (!rootSessionId) {
			return undefined;
		}
		const root = this.readRootSession(rootSessionId);
		if (!root) {
			return undefined;
		}
		const sessionId = makeSubSessionId(rootSessionId, input.agentId);
		const existing = this.store.queryOne<{
			session_id?: string;
			prompt?: string | null;
			status_lock?: number;
		}>(
			`SELECT session_id, prompt, status_lock FROM sessions WHERE session_id = ?`,
			[sessionId],
		);
		const startedAt = nowIso();
		const artifactPaths = this.subagentArtifactPaths(
			sessionId,
			input.parentAgentId,
			input.agentId,
		);
		const transcriptPath = artifactPaths.transcriptPath;
		const hookPath = artifactPaths.hookPath;
		const messagesPath = artifactPaths.messagesPath;
		let prompt = input.prompt ?? existing?.prompt ?? undefined;
		if (!prompt) {
			prompt =
				this.claimQueuedSpawnTask(rootSessionId, input.parentAgentId) ??
				`Subagent run by ${input.parentAgentId}`;
		}
		if (!existing) {
			this.store.run(
				`INSERT INTO sessions (
					session_id, source, pid, started_at, ended_at, exit_code, status, status_lock, interactive,
					provider, model, cwd, workspace_root, team_name, enable_tools, enable_spawn, enable_teams,
					parent_session_id, parent_agent_id, agent_id, conversation_id, is_subagent, prompt,
					transcript_path, hook_path, messages_path, updated_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					sessionId,
					SUBSESSION_SOURCE,
					process.ppid,
					startedAt,
					null,
					null,
					"running",
					0,
					0,
					root.provider,
					root.model,
					root.cwd,
					root.workspace_root,
					root.team_name ?? null,
					root.enable_tools,
					root.enable_spawn,
					root.enable_teams,
					rootSessionId,
					input.parentAgentId,
					input.agentId,
					input.conversationId,
					1,
					prompt,
					transcriptPath,
					hookPath,
					messagesPath,
					startedAt,
				],
			);
			writeFileSync(
				messagesPath,
				`${JSON.stringify({ version: 1, updated_at: startedAt, messages: [] }, null, 2)}\n`,
				"utf8",
			);
			return sessionId;
		}

		const lock =
			typeof existing.status_lock === "number" ? existing.status_lock : 0;
		this.store.run(
			`UPDATE sessions
			 SET status = 'running', ended_at = NULL, exit_code = NULL, updated_at = ?, status_lock = ?,
				 parent_session_id = ?, parent_agent_id = ?, agent_id = ?, conversation_id = ?, is_subagent = 1,
				 prompt = COALESCE(prompt, ?)
			 WHERE session_id = ?`,
			[
				nowIso(),
				lock + 1,
				rootSessionId,
				input.parentAgentId,
				input.agentId,
				input.conversationId,
				prompt,
				sessionId,
			],
		);
		return sessionId;
	}

	upsertSubagentSessionFromHook(event: HookEventPayload): string | undefined {
		if (!event.parent_agent_id) {
			return undefined;
		}
		return this.upsertSubagentSession({
			agentId: event.agent_id,
			parentAgentId: event.parent_agent_id,
			conversationId: event.taskId,
		});
	}

	appendSubagentHookAudit(subSessionId: string, event: HookEventPayload): void {
		const line = `${JSON.stringify({ ts: nowIso(), ...event })}\n`;
		const path =
			this.sessionPathFromStore(subSessionId, "hook_path") ??
			this.sessionHookPath(subSessionId);
		appendFileSync(path, line, "utf8");
	}

	appendSubagentTranscriptLine(subSessionId: string, line: string): void {
		if (!line.trim()) {
			return;
		}
		const path =
			this.sessionPathFromStore(subSessionId, "transcript_path") ??
			this.sessionTranscriptPath(subSessionId);
		appendFileSync(path, `${line}\n`, "utf8");
	}

	persistSessionMessages(
		sessionId: string,
		messages: LlmsProviders.Message[],
	): void {
		const row = this.store.queryOne<{ messages_path?: string | null }>(
			`SELECT messages_path FROM sessions WHERE session_id = ?`,
			[sessionId],
		);
		const path =
			row?.messages_path?.trim() || this.sessionMessagesPath(sessionId);
		writeFileSync(
			path,
			`${JSON.stringify({ version: 1, updated_at: nowIso(), messages }, null, 2)}\n`,
			"utf8",
		);
	}

	applySubagentStatus(subSessionId: string, event: HookEventPayload): void {
		this.applySubagentStatusBySessionId(
			subSessionId,
			deriveSubsessionStatus(event),
		);
	}

	applySubagentStatusBySessionId(
		subSessionId: string,
		status: SessionStatus,
	): void {
		const row = this.store.queryOne<{ status_lock?: number }>(
			`SELECT status_lock FROM sessions WHERE session_id = ?`,
			[subSessionId],
		);
		if (!row || typeof row.status_lock !== "number") {
			return;
		}
		const ts = nowIso();
		const endedAt = status === "running" ? null : ts;
		const exitCode = status === "failed" ? 1 : 0;
		this.store.run(
			`UPDATE sessions
			 SET status = ?, ended_at = ?, exit_code = ?, updated_at = ?, status_lock = ?
			 WHERE session_id = ? AND status_lock = ?`,
			[
				status,
				endedAt,
				status === "running" ? null : exitCode,
				ts,
				row.status_lock + 1,
				subSessionId,
				row.status_lock,
			],
		);
	}

	applyStatusToRunningChildSessions(
		parentSessionId: string,
		status: Exclude<SessionStatus, "running">,
	): void {
		if (!parentSessionId) {
			return;
		}
		const rows = this.store.queryAll<{ session_id?: string }>(
			`SELECT session_id FROM sessions WHERE parent_session_id = ? AND status = 'running'`,
			[parentSessionId],
		);
		for (const row of rows) {
			if (!row.session_id) {
				continue;
			}
			this.applySubagentStatusBySessionId(row.session_id, status);
		}
	}

	private createTeamTaskSubSession(
		agentId: string,
		message: string,
	): string | undefined {
		const rootSessionId = getRootSessionIdFromEnv();
		if (!rootSessionId) {
			return undefined;
		}
		const root = this.readRootSession(rootSessionId);
		if (!root) {
			return undefined;
		}
		const sessionId = makeTeamTaskSubSessionId(rootSessionId, agentId);
		const startedAt = nowIso();
		const transcriptPath = this.sessionTranscriptPath(sessionId);
		const hookPath = this.sessionHookPath(sessionId);
		const messagesPath = this.sessionMessagesPath(sessionId);
		this.store.run(
			`INSERT INTO sessions (
				session_id, source, pid, started_at, ended_at, exit_code, status, status_lock, interactive,
				provider, model, cwd, workspace_root, team_name, enable_tools, enable_spawn, enable_teams,
				parent_session_id, parent_agent_id, agent_id, conversation_id, is_subagent, prompt,
				transcript_path, hook_path, messages_path, updated_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				sessionId,
				SUBSESSION_SOURCE,
				process.ppid,
				startedAt,
				null,
				null,
				"running",
				0,
				0,
				root.provider,
				root.model,
				root.cwd,
				root.workspace_root,
				root.team_name ?? null,
				root.enable_tools,
				root.enable_spawn,
				root.enable_teams,
				rootSessionId,
				"lead",
				agentId,
				null,
				1,
				message || `Team task for ${agentId}`,
				transcriptPath,
				hookPath,
				messagesPath,
				startedAt,
			],
		);
		writeFileSync(
			messagesPath,
			`${JSON.stringify({ version: 1, updated_at: startedAt, messages: [] }, null, 2)}\n`,
			"utf8",
		);
		this.appendSubagentTranscriptLine(sessionId, `[start] ${message}`);
		return sessionId;
	}

	onTeamTaskStart(agentId: string, message: string): void {
		const sessionId = this.createTeamTaskSubSession(agentId, message);
		if (!sessionId) {
			return;
		}
		const queue = this.teamTaskSessionsByAgent.get(agentId) ?? [];
		queue.push(sessionId);
		this.teamTaskSessionsByAgent.set(agentId, queue);
	}

	onTeamTaskEnd(
		agentId: string,
		status: SessionStatus,
		summary?: string,
		messages?: LlmsProviders.Message[],
	): void {
		const queue = this.teamTaskSessionsByAgent.get(agentId);
		if (!queue || queue.length === 0) {
			return;
		}
		const sessionId = queue.shift();
		if (queue.length === 0) {
			this.teamTaskSessionsByAgent.delete(agentId);
		} else {
			this.teamTaskSessionsByAgent.set(agentId, queue);
		}
		if (!sessionId) {
			return;
		}
		if (messages) {
			this.persistSessionMessages(sessionId, messages);
		}
		this.appendSubagentTranscriptLine(sessionId, summary ?? `[done] ${status}`);
		this.applySubagentStatusBySessionId(sessionId, status);
	}

	handleSubAgentStart(context: SubAgentStartContext): void {
		const subSessionId = this.upsertSubagentSession({
			agentId: context.subAgentId,
			parentAgentId: context.parentAgentId,
			conversationId: context.conversationId,
			prompt: context.input.task,
		});
		if (!subSessionId) {
			return;
		}
		this.appendSubagentTranscriptLine(
			subSessionId,
			`[start] ${context.input.task}`,
		);
		this.applySubagentStatusBySessionId(subSessionId, "running");
	}

	handleSubAgentEnd(context: SubAgentEndContext): void {
		const subSessionId = this.upsertSubagentSession({
			agentId: context.subAgentId,
			parentAgentId: context.parentAgentId,
			conversationId: context.conversationId,
			prompt: context.input.task,
		});
		if (!subSessionId) {
			return;
		}
		if (context.error) {
			this.appendSubagentTranscriptLine(
				subSessionId,
				`[error] ${context.error.message}`,
			);
			this.applySubagentStatusBySessionId(subSessionId, "failed");
			return;
		}
		this.appendSubagentTranscriptLine(
			subSessionId,
			`[done] ${context.result?.finishReason ?? "completed"}`,
		);
		if (context.result?.finishReason === "aborted") {
			this.applySubagentStatusBySessionId(subSessionId, "cancelled");
			return;
		}
		this.applySubagentStatusBySessionId(subSessionId, "completed");
	}

	listCliSessions(limit = 200): SessionRowShape[] {
		const requestedLimit = Math.max(1, Math.floor(limit));
		const scanLimit = Math.min(requestedLimit * 5, 2000);
		const rows = this.store.queryAll<SessionRowShape>(
			`SELECT session_id, source, pid, started_at, ended_at, exit_code, status, status_lock, interactive,
					provider, model, cwd, workspace_root, team_name, enable_tools, enable_spawn, enable_teams,
					parent_session_id, parent_agent_id, agent_id, conversation_id, is_subagent, prompt,
					transcript_path, hook_path, messages_path, updated_at
			 FROM sessions
			 ORDER BY started_at DESC
			 LIMIT ?`,
			[scanLimit],
		);
		return rows
			.filter((row) => this.hasPersistedConversation(row))
			.slice(0, requestedLimit);
	}

	private hasPersistedConversation(row: SessionRowShape): boolean {
		if ((row.prompt ?? "").trim().length > 0) {
			return true;
		}
		const messagesPath =
			row.messages_path?.trim() || this.sessionMessagesPath(row.session_id);
		if (!messagesPath || !existsSync(messagesPath)) {
			return false;
		}
		try {
			const raw = readFileSync(messagesPath, "utf8");
			if (!raw.trim()) {
				return false;
			}
			const parsed = JSON.parse(raw) as { messages?: unknown } | unknown[];
			const messages = Array.isArray(parsed)
				? parsed
				: Array.isArray((parsed as { messages?: unknown })?.messages)
					? ((parsed as { messages: unknown[] }).messages ?? [])
					: [];
			return messages.length > 0;
		} catch {
			// Keep the row on parse/read failures rather than hiding potentially valid sessions.
			return true;
		}
	}

	deleteCliSession(sessionId: string): { deleted: boolean } {
		const id = sessionId.trim();
		if (!id) {
			throw new Error("session id is required");
		}
		const row = this.store.queryOne<{
			transcript_path?: string;
			hook_path?: string;
			messages_path?: string;
			is_subagent?: number;
		}>(
			`SELECT transcript_path, hook_path, messages_path, is_subagent FROM sessions WHERE session_id = ?`,
			[id],
		);
		if (!row) {
			return { deleted: false };
		}
		this.store.run(`DELETE FROM sessions WHERE session_id = ?`, [id]);
		if (!row.is_subagent) {
			const children = this.store.queryAll<{
				session_id?: string;
				transcript_path?: string;
				hook_path?: string;
				messages_path?: string;
			}>(
				`SELECT session_id, transcript_path, hook_path, messages_path FROM sessions WHERE parent_session_id = ?`,
				[id],
			);
			this.store.run(`DELETE FROM sessions WHERE parent_session_id = ?`, [id]);
			for (const child of children) {
				unlinkIfExists(child.transcript_path);
				unlinkIfExists(child.hook_path);
				unlinkIfExists(child.messages_path);
				if (child.session_id) {
					unlinkIfExists(this.sessionManifestPath(child.session_id, false));
					this.artifacts.removeSessionDirIfEmpty(child.session_id);
				}
			}
		}
		unlinkIfExists(row.transcript_path);
		unlinkIfExists(row.hook_path);
		unlinkIfExists(row.messages_path);
		unlinkIfExists(this.sessionManifestPath(id, false));
		this.artifacts.removeSessionDirIfEmpty(id);
		return { deleted: true };
	}
}
