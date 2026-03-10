import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import type {
	HookEventPayload,
	SubAgentEndContext,
	SubAgentStartContext,
} from "@cline/agents";
import type { providers as LlmsProviders } from "@cline/llms";
import { RpcSessionClient, type RpcSessionRow } from "@cline/rpc";
import { resolveRootSessionId } from "@cline/shared";
import { nanoid } from "nanoid";
import { z } from "zod";
import { SessionSource, type SessionStatus } from "../types/common";
import { nowIso, SessionArtifacts, unlinkIfExists } from "./session-artifacts";
import {
	deriveSubsessionStatus,
	makeSubSessionId,
	makeTeamTaskSubSessionId,
} from "./session-graph";
import {
	type SessionManifest,
	SessionManifestSchema,
} from "./session-manifest";
import type {
	CreateRootSessionWithArtifactsInput,
	RootSessionArtifacts,
	SessionRowShape,
	UpsertSubagentInput,
} from "./session-service";

const SUBSESSION_SOURCE = SessionSource.CLI_SUBAGENT;
const SpawnAgentInputSchema = z
	.object({
		task: z.string().optional(),
		systemPrompt: z.string().optional(),
	})
	.passthrough();

function toShape(row: RpcSessionRow): SessionRowShape {
	return {
		session_id: row.sessionId,
		source: row.source,
		pid: row.pid,
		started_at: row.startedAt,
		ended_at: row.endedAt ?? null,
		exit_code: row.exitCode ?? null,
		status: row.status,
		status_lock: row.statusLock,
		interactive: row.interactive ? 1 : 0,
		provider: row.provider,
		model: row.model,
		cwd: row.cwd,
		workspace_root: row.workspaceRoot,
		team_name: row.teamName ?? null,
		enable_tools: row.enableTools ? 1 : 0,
		enable_spawn: row.enableSpawn ? 1 : 0,
		enable_teams: row.enableTeams ? 1 : 0,
		parent_session_id: row.parentSessionId ?? null,
		parent_agent_id: row.parentAgentId ?? null,
		agent_id: row.agentId ?? null,
		conversation_id: row.conversationId ?? null,
		is_subagent: row.isSubagent ? 1 : 0,
		prompt: row.prompt ?? null,
		transcript_path: row.transcriptPath,
		hook_path: row.hookPath,
		messages_path: row.messagesPath ?? null,
		updated_at: row.updatedAt,
	};
}

function fromRootInput(
	input: CreateRootSessionWithArtifactsInput & {
		sessionId: string;
		startedAt: string;
		transcriptPath: string;
		hookPath: string;
		messagesPath: string;
		prompt?: string;
	},
): RpcSessionRow {
	return {
		sessionId: input.sessionId,
		source: input.source,
		pid: input.pid,
		startedAt: input.startedAt,
		endedAt: null,
		exitCode: null,
		status: "running",
		statusLock: 0,
		interactive: input.interactive,
		provider: input.provider,
		model: input.model,
		cwd: input.cwd,
		workspaceRoot: input.workspaceRoot,
		teamName: input.teamName,
		enableTools: input.enableTools,
		enableSpawn: input.enableSpawn,
		enableTeams: input.enableTeams,
		isSubagent: false,
		prompt: input.prompt,
		transcriptPath: input.transcriptPath,
		hookPath: input.hookPath,
		messagesPath: input.messagesPath,
		updatedAt: nowIso(),
	};
}

export interface RpcCoreSessionServiceOptions {
	address?: string;
	sessionsDir: string;
}

export class RpcCoreSessionService {
	private readonly teamTaskSessionsByAgent = new Map<string, string[]>();
	private readonly sessionsDirPath: string;
	private readonly artifacts: SessionArtifacts;
	private readonly client: RpcSessionClient;

	constructor(options: RpcCoreSessionServiceOptions) {
		this.sessionsDirPath = options.sessionsDir;
		this.artifacts = new SessionArtifacts(() => this.ensureSessionsDir());
		this.client = new RpcSessionClient({
			address: options.address?.trim() || "127.0.0.1:4317",
		});
	}

	private teamTaskQueueKey(rootSessionId: string, agentId: string): string {
		return `${rootSessionId}::${agentId}`;
	}

	ensureSessionsDir(): string {
		if (!existsSync(this.sessionsDirPath)) {
			mkdirSync(this.sessionsDirPath, { recursive: true });
		}
		return this.sessionsDirPath;
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

	private activeTeamTaskSessionId(
		rootSessionId: string,
		parentAgentId: string,
	): string | undefined {
		const queue = this.teamTaskSessionsByAgent.get(
			this.teamTaskQueueKey(rootSessionId, parentAgentId),
		);
		if (!queue || queue.length === 0) {
			return undefined;
		}
		return queue[queue.length - 1];
	}

	private subagentArtifactPaths(
		rootSessionId: string,
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
			this.activeTeamTaskSessionId(rootSessionId, parentAgentId),
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

	async createRootSessionWithArtifacts(
		input: CreateRootSessionWithArtifactsInput,
	): Promise<RootSessionArtifacts> {
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

		await this.client.upsertSession(
			fromRootInput({
				...input,
				sessionId,
				startedAt,
				transcriptPath,
				hookPath,
				messagesPath,
				prompt: manifest.prompt,
			}),
		);

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
		};
	}

	writeSessionManifest(manifestPath: string, manifest: SessionManifest): void {
		this.writeSessionManifestFile(manifestPath, manifest);
	}

	async updateSessionStatus(
		sessionId: string,
		status: SessionStatus,
		exitCode?: number | null,
	): Promise<{ updated: boolean; endedAt?: string }> {
		for (let attempt = 0; attempt < 4; attempt++) {
			const row = await this.client.getSession(sessionId);
			if (!row) {
				return { updated: false };
			}
			const endedAt = nowIso();
			const changed = await this.client.updateSession({
				sessionId,
				status,
				endedAt,
				exitCode: typeof exitCode === "number" ? exitCode : null,
				expectedStatusLock: row.statusLock,
			});
			if (changed.updated) {
				if (status === "cancelled") {
					await this.applyStatusToRunningChildSessions(sessionId, "cancelled");
				}
				return { updated: true, endedAt };
			}
		}
		return { updated: false };
	}

	async queueSpawnRequest(event: HookEventPayload): Promise<void> {
		if (event.hookName !== "tool_call" || event.parent_agent_id !== null) {
			return;
		}
		if (event.tool_call?.name !== "spawn_agent") {
			return;
		}
		const rootSessionId = resolveRootSessionId(event.sessionContext);
		if (!rootSessionId) {
			return;
		}
		const parsedInput = SpawnAgentInputSchema.safeParse(event.tool_call.input);
		const task = parsedInput.success ? parsedInput.data.task : undefined;
		const systemPrompt = parsedInput.success
			? parsedInput.data.systemPrompt
			: undefined;
		await this.client.enqueueSpawnRequest({
			rootSessionId,
			parentAgentId: event.agent_id,
			task,
			systemPrompt,
		});
	}

	private async readRootSession(
		rootSessionId: string,
	): Promise<SessionRowShape | null> {
		const row = await this.client.getSession(rootSessionId);
		return row ? toShape(row) : null;
	}

	private async claimQueuedSpawnTask(
		rootSessionId: string,
		parentAgentId: string,
	): Promise<string | undefined> {
		return await this.client.claimSpawnRequest(rootSessionId, parentAgentId);
	}

	async upsertSubagentSession(
		input: UpsertSubagentInput,
	): Promise<string | undefined> {
		const rootSessionId = input.rootSessionId;
		if (!rootSessionId) {
			return undefined;
		}
		const root = await this.readRootSession(rootSessionId);
		if (!root) {
			return undefined;
		}
		const sessionId = makeSubSessionId(rootSessionId, input.agentId);
		const existing = await this.client.getSession(sessionId);
		const startedAt = nowIso();
		const artifactPaths = this.subagentArtifactPaths(
			rootSessionId,
			sessionId,
			input.parentAgentId,
			input.agentId,
		);
		let prompt = input.prompt ?? existing?.prompt ?? undefined;
		if (!prompt) {
			prompt =
				(await this.claimQueuedSpawnTask(rootSessionId, input.parentAgentId)) ??
				`Subagent run by ${input.parentAgentId}`;
		}
		if (!existing) {
			await this.client.upsertSession({
				sessionId,
				source: SUBSESSION_SOURCE,
				pid: process.ppid,
				startedAt,
				endedAt: null,
				exitCode: null,
				status: "running",
				statusLock: 0,
				interactive: false,
				provider: root.provider,
				model: root.model,
				cwd: root.cwd,
				workspaceRoot: root.workspace_root,
				teamName: root.team_name ?? undefined,
				enableTools: root.enable_tools === 1,
				enableSpawn: root.enable_spawn === 1,
				enableTeams: root.enable_teams === 1,
				parentSessionId: rootSessionId,
				parentAgentId: input.parentAgentId,
				agentId: input.agentId,
				conversationId: input.conversationId,
				isSubagent: true,
				prompt,
				transcriptPath: artifactPaths.transcriptPath,
				hookPath: artifactPaths.hookPath,
				messagesPath: artifactPaths.messagesPath,
				updatedAt: startedAt,
			});
			writeFileSync(
				artifactPaths.messagesPath,
				`${JSON.stringify({ version: 1, updated_at: startedAt, messages: [] }, null, 2)}\n`,
				"utf8",
			);
			return sessionId;
		}

		await this.client.updateSession({
			sessionId,
			setRunning: true,
			parentSessionId: rootSessionId,
			parentAgentId: input.parentAgentId,
			agentId: input.agentId,
			conversationId: input.conversationId,
			prompt: existing.prompt ?? prompt ?? null,
			expectedStatusLock: existing.statusLock,
		});
		return sessionId;
	}

	async upsertSubagentSessionFromHook(
		event: HookEventPayload,
	): Promise<string | undefined> {
		if (!event.parent_agent_id) {
			return undefined;
		}
		const rootSessionId = resolveRootSessionId(event.sessionContext);
		if (!rootSessionId) {
			return undefined;
		}
		if (event.hookName === "session_shutdown") {
			const sessionId = makeSubSessionId(rootSessionId, event.agent_id);
			const existing = await this.client.getSession(sessionId);
			return existing ? sessionId : undefined;
		}
		return await this.upsertSubagentSession({
			agentId: event.agent_id,
			parentAgentId: event.parent_agent_id,
			conversationId: event.taskId,
			rootSessionId,
		});
	}

	async appendSubagentHookAudit(
		subSessionId: string,
		event: HookEventPayload,
	): Promise<void> {
		const line = `${JSON.stringify({ ts: nowIso(), ...event })}\n`;
		const row = await this.client.getSession(subSessionId);
		const path = row?.hookPath ?? this.sessionHookPath(subSessionId);
		appendFileSync(path, line, "utf8");
	}

	async appendSubagentTranscriptLine(
		subSessionId: string,
		line: string,
	): Promise<void> {
		if (!line.trim()) {
			return;
		}
		const row = await this.client.getSession(subSessionId);
		const path =
			row?.transcriptPath ?? this.sessionTranscriptPath(subSessionId);
		appendFileSync(path, `${line}\n`, "utf8");
	}

	async persistSessionMessages(
		sessionId: string,
		messages: LlmsProviders.Message[],
	): Promise<void> {
		const row = await this.client.getSession(sessionId);
		const path = row?.messagesPath || this.sessionMessagesPath(sessionId);
		writeFileSync(
			path,
			`${JSON.stringify({ version: 1, updated_at: nowIso(), messages }, null, 2)}\n`,
			"utf8",
		);
	}

	async applySubagentStatus(
		subSessionId: string,
		event: HookEventPayload,
	): Promise<void> {
		await this.applySubagentStatusBySessionId(
			subSessionId,
			deriveSubsessionStatus(event),
		);
	}

	async applySubagentStatusBySessionId(
		subSessionId: string,
		status: SessionStatus,
	): Promise<void> {
		const row = await this.client.getSession(subSessionId);
		if (!row) {
			return;
		}
		const ts = nowIso();
		const endedAt = status === "running" ? "" : ts;
		const exitCode = status === "failed" ? 1 : 0;
		await this.client.updateSession({
			sessionId: subSessionId,
			status,
			endedAt,
			exitCode: status === "running" ? null : exitCode,
			expectedStatusLock: row.statusLock,
		});
	}

	async applyStatusToRunningChildSessions(
		parentSessionId: string,
		status: Exclude<SessionStatus, "running">,
	): Promise<void> {
		if (!parentSessionId) {
			return;
		}
		const rows = await this.client.listSessions({
			limit: 2000,
			parentSessionId,
			status: "running",
		});
		for (const row of rows) {
			await this.applySubagentStatusBySessionId(row.sessionId, status);
		}
	}

	private async createTeamTaskSubSession(
		rootSessionId: string,
		agentId: string,
		message: string,
	): Promise<string | undefined> {
		const root = await this.readRootSession(rootSessionId);
		if (!root) {
			return undefined;
		}
		const sessionId = makeTeamTaskSubSessionId(rootSessionId, agentId);
		const startedAt = nowIso();
		const transcriptPath = this.sessionTranscriptPath(sessionId);
		const hookPath = this.sessionHookPath(sessionId);
		const messagesPath = this.sessionMessagesPath(sessionId);
		await this.client.upsertSession({
			sessionId,
			source: SUBSESSION_SOURCE,
			pid: process.ppid,
			startedAt,
			endedAt: null,
			exitCode: null,
			status: "running",
			statusLock: 0,
			interactive: false,
			provider: root.provider,
			model: root.model,
			cwd: root.cwd,
			workspaceRoot: root.workspace_root,
			teamName: root.team_name ?? undefined,
			enableTools: root.enable_tools === 1,
			enableSpawn: root.enable_spawn === 1,
			enableTeams: root.enable_teams === 1,
			parentSessionId: rootSessionId,
			parentAgentId: "lead",
			agentId,
			conversationId: undefined,
			isSubagent: true,
			prompt: message || `Team task for ${agentId}`,
			transcriptPath,
			hookPath,
			messagesPath,
			updatedAt: startedAt,
		});
		writeFileSync(
			messagesPath,
			`${JSON.stringify({ version: 1, updated_at: startedAt, messages: [] }, null, 2)}\n`,
			"utf8",
		);
		await this.appendSubagentTranscriptLine(sessionId, `[start] ${message}`);
		return sessionId;
	}

	async onTeamTaskStart(
		rootSessionId: string,
		agentId: string,
		message: string,
	): Promise<void> {
		const sessionId = await this.createTeamTaskSubSession(
			rootSessionId,
			agentId,
			message,
		);
		if (!sessionId) {
			return;
		}
		const key = this.teamTaskQueueKey(rootSessionId, agentId);
		const queue = this.teamTaskSessionsByAgent.get(key) ?? [];
		queue.push(sessionId);
		this.teamTaskSessionsByAgent.set(key, queue);
	}

	async onTeamTaskEnd(
		rootSessionId: string,
		agentId: string,
		status: SessionStatus,
		summary?: string,
		messages?: LlmsProviders.Message[],
	): Promise<void> {
		const key = this.teamTaskQueueKey(rootSessionId, agentId);
		const queue = this.teamTaskSessionsByAgent.get(key);
		if (!queue || queue.length === 0) {
			return;
		}
		const sessionId = queue.shift();
		if (queue.length === 0) {
			this.teamTaskSessionsByAgent.delete(key);
		} else {
			this.teamTaskSessionsByAgent.set(key, queue);
		}
		if (!sessionId) {
			return;
		}
		if (messages) {
			await this.persistSessionMessages(sessionId, messages);
		}
		await this.appendSubagentTranscriptLine(
			sessionId,
			summary ?? `[done] ${status}`,
		);
		await this.applySubagentStatusBySessionId(sessionId, status);
	}

	async handleSubAgentStart(
		rootSessionId: string,
		context: SubAgentStartContext,
	): Promise<void> {
		const subSessionId = await this.upsertSubagentSession({
			agentId: context.subAgentId,
			parentAgentId: context.parentAgentId,
			conversationId: context.conversationId,
			prompt: context.input.task,
			rootSessionId,
		});
		if (!subSessionId) {
			return;
		}
		await this.appendSubagentTranscriptLine(
			subSessionId,
			`[start] ${context.input.task}`,
		);
		await this.applySubagentStatusBySessionId(subSessionId, "running");
	}

	async handleSubAgentEnd(
		rootSessionId: string,
		context: SubAgentEndContext,
	): Promise<void> {
		const subSessionId = await this.upsertSubagentSession({
			agentId: context.subAgentId,
			parentAgentId: context.parentAgentId,
			conversationId: context.conversationId,
			prompt: context.input.task,
			rootSessionId,
		});
		if (!subSessionId) {
			return;
		}
		if (context.error) {
			await this.appendSubagentTranscriptLine(
				subSessionId,
				`[error] ${context.error.message}`,
			);
			await this.applySubagentStatusBySessionId(subSessionId, "failed");
			return;
		}
		await this.appendSubagentTranscriptLine(
			subSessionId,
			`[done] ${context.result?.finishReason ?? "completed"}`,
		);
		if (context.result?.finishReason === "aborted") {
			await this.applySubagentStatusBySessionId(subSessionId, "cancelled");
			return;
		}
		await this.applySubagentStatusBySessionId(subSessionId, "completed");
	}

	async listSessions(limit = 200): Promise<SessionRowShape[]> {
		const requestedLimit = Math.max(1, Math.floor(limit));
		const scanLimit = Math.min(requestedLimit * 5, 2000);
		let rows = await this.client.listSessions({ limit: scanLimit });
		const staleRunning = rows.filter(
			(row) => row.status === "running" && !this.isPidAlive(row.pid),
		);
		if (staleRunning.length > 0) {
			for (const row of staleRunning) {
				await this.updateSessionStatus(row.sessionId, "failed", 1);
			}
			rows = await this.client.listSessions({ limit: scanLimit });
		}
		return rows.map((row) => toShape(row)).slice(0, requestedLimit);
	}

	private isPidAlive(pid: number): boolean {
		if (!Number.isFinite(pid) || pid <= 0) {
			return false;
		}
		try {
			process.kill(Math.floor(pid), 0);
			return true;
		} catch (error) {
			return (
				typeof error === "object" &&
				error !== null &&
				"code" in error &&
				(error as { code?: string }).code === "EPERM"
			);
		}
	}

	async deleteSession(sessionId: string): Promise<{ deleted: boolean }> {
		const id = sessionId.trim();
		if (!id) {
			throw new Error("session id is required");
		}
		const row = await this.client.getSession(id);
		if (!row) {
			return { deleted: false };
		}
		await this.client.deleteSession(id, false);
		if (!row.isSubagent) {
			const children = await this.client.listSessions({
				limit: 2000,
				parentSessionId: id,
			});
			await this.client.deleteSession(id, true);
			for (const child of children) {
				unlinkIfExists(child.transcriptPath);
				unlinkIfExists(child.hookPath);
				unlinkIfExists(child.messagesPath);
				unlinkIfExists(this.sessionManifestPath(child.sessionId, false));
				this.artifacts.removeSessionDirIfEmpty(child.sessionId);
			}
		}
		unlinkIfExists(row.transcriptPath);
		unlinkIfExists(row.hookPath);
		unlinkIfExists(row.messagesPath);
		unlinkIfExists(this.sessionManifestPath(id, false));
		this.artifacts.removeSessionDirIfEmpty(id);
		return { deleted: true };
	}
}
