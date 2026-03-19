import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveSessionDataDir } from "@clinebot/shared/storage";

type SessionManifest = {
	metadata?: Record<string, unknown>;
	[key: string]: unknown;
};

function manifestPathForSession(sessionId: string): string {
	return join(resolveSessionDataDir(), sessionId, `${sessionId}.json`);
}

function normalizeSessionTitle(title?: string | null): string | undefined {
	const trimmed = title?.trim();
	return trimmed ? trimmed.slice(0, 120) : undefined;
}

export function readSessionManifestTitle(
	sessionId: string,
): string | undefined {
	const trimmedSessionId = sessionId.trim();
	if (!trimmedSessionId) {
		return undefined;
	}
	const path = manifestPathForSession(trimmedSessionId);
	if (!existsSync(path)) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as SessionManifest;
		const value = parsed.metadata?.title;
		return typeof value === "string" ? normalizeSessionTitle(value) : undefined;
	} catch {
		return undefined;
	}
}

export function updateSessionManifestTitle(
	sessionId: string,
	title?: string | null,
): { updated: boolean } {
	const trimmedSessionId = sessionId.trim();
	if (!trimmedSessionId) {
		return { updated: false };
	}
	const path = manifestPathForSession(trimmedSessionId);
	if (!existsSync(path)) {
		return { updated: false };
	}
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as SessionManifest;
		const nextMetadata = { ...(parsed.metadata ?? {}) };
		const normalizedTitle = normalizeSessionTitle(title);
		if (normalizedTitle) {
			nextMetadata.title = normalizedTitle;
		} else {
			delete nextMetadata.title;
		}
		const nextManifest: SessionManifest = {
			...parsed,
			metadata: Object.keys(nextMetadata).length > 0 ? nextMetadata : undefined,
		};
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, `${JSON.stringify(nextManifest, null, 2)}\n`, "utf8");
		return { updated: true };
	} catch {
		return { updated: false };
	}
}
