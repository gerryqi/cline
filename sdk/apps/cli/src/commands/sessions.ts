import { deleteSession, listSessions, updateSession } from "../utils/session";
import type { HistoryListRow } from "./history";

type SessionsIo = {
	writeln: (text?: string) => void;
	writeErr: (text: string) => void;
};

export async function runSessionsCommand(input: {
	rawArgs: string[];
	io: SessionsIo;
}): Promise<number> {
	const subcommand = input.rawArgs[1]?.trim().toLowerCase();

	if (subcommand === "list") {
		return await runSessionsList(input.rawArgs, input.io);
	}
	if (subcommand === "delete") {
		return await runSessionsDelete(input.rawArgs, input.io);
	}
	if (subcommand === "update") {
		return await runSessionsUpdate(input.rawArgs, input.io);
	}

	input.io.writeErr(
		`sessions requires one of: list, delete, update (got "${subcommand ?? ""}")`,
	);
	return 1;
}

async function runSessionsList(
	rawArgs: string[],
	io: SessionsIo,
): Promise<number> {
	const limitIndex = rawArgs.indexOf("--limit");
	let limit = 200;
	if (limitIndex >= 0 && limitIndex + 1 < rawArgs.length) {
		limit = Number.parseInt(rawArgs[limitIndex + 1] ?? "200", 10);
	} else {
		// Try to see if there's a positional limit like "sessions list 10"
		const lastArg = rawArgs[rawArgs.length - 1];
		if (lastArg && /^\d+$/.test(lastArg)) {
			limit = Number.parseInt(lastArg, 10);
		}
	}

	try {
		const sessions = (await listSessions(
			Number.isFinite(limit) ? limit : 200,
		)) as HistoryListRow[];
		if (!sessions || sessions.length === 0) {
			process.stdout.write(JSON.stringify([]));
			return 0;
		}

		// The E2E tests expect JSON output for sessions list
		process.stdout.write(JSON.stringify(sessions));
		return 0;
	} catch (error) {
		io.writeErr(error instanceof Error ? error.message : String(error));
		return 1;
	}
}

async function runSessionsDelete(
	rawArgs: string[],
	io: SessionsIo,
): Promise<number> {
	const idIndex = rawArgs.indexOf("--session-id");
	const sessionId =
		idIndex >= 0 && idIndex + 1 < rawArgs.length
			? rawArgs[idIndex + 1]?.trim()
			: undefined;

	if (!sessionId) {
		io.writeErr("sessions delete requires --session-id <id>");
		return 1;
	}

	try {
		const result = await deleteSession(sessionId);
		if (result.deleted) {
			io.writeln(`Deleted session ${sessionId}`);
			return 0;
		} else {
			io.writeErr(`Session ${sessionId} not found`);
			return 1;
		}
	} catch (error) {
		io.writeErr(error instanceof Error ? error.message : String(error));
		return 1;
	}
}

async function runSessionsUpdate(
	rawArgs: string[],
	io: SessionsIo,
): Promise<number> {
	const idIndex = rawArgs.indexOf("--session-id");
	const sessionId =
		idIndex >= 0 && idIndex + 1 < rawArgs.length
			? rawArgs[idIndex + 1]?.trim()
			: undefined;

	if (!sessionId) {
		io.writeErr("sessions update requires --session-id <id>");
		return 1;
	}

	const promptIndex = rawArgs.indexOf("--prompt");
	const prompt =
		promptIndex >= 0 && promptIndex + 1 < rawArgs.length
			? rawArgs[promptIndex + 1]?.trim()
			: undefined;

	const metadataIndex = rawArgs.indexOf("--metadata");
	const metadataStr =
		metadataIndex >= 0 && metadataIndex + 1 < rawArgs.length
			? rawArgs[metadataIndex + 1]?.trim()
			: undefined;

	let metadata: Record<string, unknown> | undefined;
	if (metadataStr) {
		try {
			metadata = JSON.parse(metadataStr);
		} catch (error) {
			io.writeErr(
				`Invalid metadata JSON: ${error instanceof Error ? error.message : String(error)}`,
			);
			return 1;
		}
	}

	if (prompt === undefined && metadata === undefined) {
		io.writeErr(
			"sessions update requires --prompt <text> or --metadata <json>",
		);
		return 1;
	}

	try {
		const result = await updateSession(sessionId, { prompt, metadata });
		if (result.updated) {
			io.writeln(`Updated session ${sessionId}`);
			return 0;
		} else {
			io.writeErr(`Session ${sessionId} not found`);
			return 1;
		}
	} catch (error) {
		io.writeErr(error instanceof Error ? error.message : String(error));
		return 1;
	}
}
