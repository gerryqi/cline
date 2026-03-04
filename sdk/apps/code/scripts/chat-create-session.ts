import { readFileSync } from "node:fs";
import {
	CoreSessionService,
	SessionSource,
	SqliteSessionStore,
} from "@cline/core/server";

type StartSessionRequest = {
	workspaceRoot: string;
	cwd?: string;
	provider: string;
	model: string;
	enableTools: boolean;
	enableSpawn: boolean;
	enableTeams: boolean;
	teamName: string;
};

function readStdin(): string {
	return readFileSync(0, "utf8");
}

function main() {
	const raw = readStdin();
	const config = JSON.parse(raw) as StartSessionRequest;
	const cwd = (config.cwd?.trim() || config.workspaceRoot).trim();
	const workspaceRoot = config.workspaceRoot.trim() || cwd;

	const sessions = new CoreSessionService(new SqliteSessionStore());
	const created = sessions.createRootSessionWithArtifacts({
		sessionId: "",
		source: SessionSource.DESKTOP_CHAT,
		pid: process.pid,
		interactive: false,
		provider: config.provider,
		model: config.model,
		cwd,
		workspaceRoot,
		teamName: config.enableTeams ? config.teamName : undefined,
		enableTools: config.enableTools,
		enableSpawn: config.enableSpawn,
		enableTeams: config.enableTeams,
	});

	process.stdout.write(
		`${JSON.stringify({ sessionId: created.manifest.session_id })}\n`,
	);
}

try {
	main();
} catch (error) {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(message);
	process.exit(1);
}
