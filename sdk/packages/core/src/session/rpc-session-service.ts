import { existsSync, mkdirSync } from "node:fs";
import { RpcSessionClient, type RpcSessionRow } from "@clinebot/rpc";
import { nowIso } from "./session-artifacts";
import type { SessionRowShape } from "./session-service";
import type {
	PersistedSessionUpdateInput,
	SessionPersistenceAdapter,
} from "./unified-session-persistence-service";
import { UnifiedSessionPersistenceService } from "./unified-session-persistence-service";

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
		metadata_json: row.metadata ? JSON.stringify(row.metadata) : null,
		transcript_path: row.transcriptPath,
		hook_path: row.hookPath,
		messages_path: row.messagesPath ?? null,
		updated_at: row.updatedAt,
	};
}

function fromShape(row: SessionRowShape): RpcSessionRow {
	return {
		sessionId: row.session_id,
		source: row.source,
		pid: row.pid,
		startedAt: row.started_at,
		endedAt: row.ended_at ?? null,
		exitCode: row.exit_code ?? null,
		status: row.status,
		statusLock: row.status_lock ?? 0,
		interactive: row.interactive === 1,
		provider: row.provider,
		model: row.model,
		cwd: row.cwd,
		workspaceRoot: row.workspace_root,
		teamName: row.team_name ?? undefined,
		enableTools: row.enable_tools === 1,
		enableSpawn: row.enable_spawn === 1,
		enableTeams: row.enable_teams === 1,
		parentSessionId: row.parent_session_id ?? undefined,
		parentAgentId: row.parent_agent_id ?? undefined,
		agentId: row.agent_id ?? undefined,
		conversationId: row.conversation_id ?? undefined,
		isSubagent: row.is_subagent === 1,
		prompt: row.prompt ?? undefined,
		metadata: (() => {
			if (!row.metadata_json) {
				return undefined;
			}
			try {
				const parsed = JSON.parse(row.metadata_json) as unknown;
				if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
					return parsed as Record<string, unknown>;
				}
			} catch {
				// Ignore malformed metadata payloads.
			}
			return undefined;
		})(),
		transcriptPath: row.transcript_path,
		hookPath: row.hook_path,
		messagesPath: row.messages_path ?? undefined,
		updatedAt: row.updated_at ?? nowIso(),
	};
}

class RpcSessionPersistenceAdapter implements SessionPersistenceAdapter {
	constructor(private readonly client: RpcSessionClient) {}

	ensureSessionsDir(): string {
		return "";
	}

	async upsertSession(row: SessionRowShape): Promise<void> {
		await this.client.upsertSession(fromShape(row));
	}

	async getSession(sessionId: string): Promise<SessionRowShape | undefined> {
		const row = await this.client.getSession(sessionId);
		return row ? toShape(row) : undefined;
	}

	async listSessions(options: {
		limit: number;
		parentSessionId?: string;
		status?: string;
	}): Promise<SessionRowShape[]> {
		const rows = await this.client.listSessions(options);
		return rows.map((row) => toShape(row));
	}

	async updateSession(
		input: PersistedSessionUpdateInput,
	): Promise<{ updated: boolean; statusLock: number }> {
		const changed = await this.client.updateSession({
			sessionId: input.sessionId,
			status: input.status,
			endedAt: input.endedAt,
			exitCode: input.exitCode,
			prompt: input.prompt,
			metadata:
				input.metadataJson === undefined
					? undefined
					: input.metadataJson
						? (JSON.parse(input.metadataJson) as Record<string, unknown>)
						: null,
			parentSessionId: input.parentSessionId,
			parentAgentId: input.parentAgentId,
			agentId: input.agentId,
			conversationId: input.conversationId,
			expectedStatusLock: input.expectedStatusLock,
			setRunning: input.setRunning,
		});
		return changed;
	}

	async deleteSession(sessionId: string, cascade: boolean): Promise<boolean> {
		return await this.client.deleteSession(sessionId, cascade);
	}

	async enqueueSpawnRequest(input: {
		rootSessionId: string;
		parentAgentId: string;
		task?: string;
		systemPrompt?: string;
	}): Promise<void> {
		await this.client.enqueueSpawnRequest(input);
	}

	async claimSpawnRequest(
		rootSessionId: string,
		parentAgentId: string,
	): Promise<string | undefined> {
		return await this.client.claimSpawnRequest(rootSessionId, parentAgentId);
	}
}

export interface RpcCoreSessionServiceOptions {
	address?: string;
	sessionsDir: string;
}

export class RpcCoreSessionService extends UnifiedSessionPersistenceService {
	private readonly sessionsDirPath: string;
	private readonly client: RpcSessionClient;

	constructor(options: RpcCoreSessionServiceOptions) {
		const client = new RpcSessionClient({
			address: options.address?.trim() || "127.0.0.1:4317",
		});
		super(new RpcSessionPersistenceAdapter(client));
		this.sessionsDirPath = options.sessionsDir;
		this.client = client;
	}

	override ensureSessionsDir(): string {
		if (!existsSync(this.sessionsDirPath)) {
			mkdirSync(this.sessionsDirPath, { recursive: true });
		}
		return this.sessionsDirPath;
	}

	close(): void {
		this.client.close();
	}
}
