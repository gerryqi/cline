import {
	existsSync,
	mkdirSync,
	readdirSync,
	rmdirSync,
	unlinkSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
	parseSubSessionId,
	parseTeamTaskSubSessionId,
	sanitizeSessionToken,
} from "./session-graph";

export function nowIso(): string {
	return new Date().toISOString();
}

export function unlinkIfExists(path: string | null | undefined): void {
	if (!path || !existsSync(path)) {
		return;
	}
	try {
		unlinkSync(path);
	} catch {
		// Best effort cleanup.
	}
}

export interface SessionArtifactPaths {
	transcriptPath: string;
	hookPath: string;
	messagesPath: string;
}

export class SessionArtifacts {
	constructor(private readonly ensureSessionsDir: () => string) {}

	public sessionArtifactsDir(sessionId: string): string {
		const teamTask = parseTeamTaskSubSessionId(sessionId);
		if (teamTask) {
			return join(
				this.ensureSessionsDir(),
				teamTask.rootSessionId,
				`teamtask-${sanitizeSessionToken(teamTask.teamTaskId)}`,
				sanitizeSessionToken(teamTask.agentId),
			);
		}
		const subSession = parseSubSessionId(sessionId);
		if (subSession) {
			return join(
				this.ensureSessionsDir(),
				subSession.rootSessionId,
				sanitizeSessionToken(subSession.agentId),
			);
		}
		return join(this.ensureSessionsDir(), sessionId);
	}

	public ensureSessionArtifactsDir(sessionId: string): string {
		const dir = this.sessionArtifactsDir(sessionId);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
		return dir;
	}

	public sessionTranscriptPath(sessionId: string): string {
		return join(this.ensureSessionArtifactsDir(sessionId), `${sessionId}.log`);
	}

	public sessionHookPath(sessionId: string): string {
		return join(
			this.ensureSessionArtifactsDir(sessionId),
			`${sessionId}.hooks.jsonl`,
		);
	}

	public sessionMessagesPath(sessionId: string): string {
		return join(
			this.ensureSessionArtifactsDir(sessionId),
			`${sessionId}.messages.json`,
		);
	}

	public sessionManifestPath(sessionId: string, ensureDir = true): string {
		const base = ensureDir
			? this.ensureSessionArtifactsDir(sessionId)
			: this.sessionArtifactsDir(sessionId);
		return join(base, `${sessionId}.json`);
	}

	public removeSessionDirIfEmpty(sessionId: string): void {
		let dir = this.sessionArtifactsDir(sessionId);
		const sessionsDir = this.ensureSessionsDir();
		while (dir.startsWith(sessionsDir) && dir !== sessionsDir) {
			if (!existsSync(dir)) {
				dir = dirname(dir);
				continue;
			}
			try {
				if (readdirSync(dir).length > 0) {
					break;
				}
				rmdirSync(dir);
			} catch {
				// Best-effort cleanup.
				break;
			}
			dir = dirname(dir);
		}
	}

	public teamTaskSubagentArtifactsDir(
		teamTaskSessionId: string,
		subAgentId: string,
	): string {
		const teamTask = parseTeamTaskSubSessionId(teamTaskSessionId);
		if (!teamTask) {
			return this.sessionArtifactsDir(teamTaskSessionId);
		}
		return join(
			this.ensureSessionsDir(),
			teamTask.rootSessionId,
			`teamtask-${sanitizeSessionToken(teamTask.teamTaskId)}`,
			sanitizeSessionToken(subAgentId),
		);
	}

	public subagentArtifactPaths(
		sessionId: string,
		subAgentId: string,
		activeTeamTaskSessionId?: string,
	): SessionArtifactPaths {
		if (!activeTeamTaskSessionId) {
			return {
				transcriptPath: this.sessionTranscriptPath(sessionId),
				hookPath: this.sessionHookPath(sessionId),
				messagesPath: this.sessionMessagesPath(sessionId),
			};
		}
		const dir = this.teamTaskSubagentArtifactsDir(
			activeTeamTaskSessionId,
			subAgentId,
		);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
		return {
			transcriptPath: join(dir, `${sessionId}.log`),
			hookPath: join(dir, `${sessionId}.hooks.jsonl`),
			messagesPath: join(dir, `${sessionId}.messages.json`),
		};
	}
}
