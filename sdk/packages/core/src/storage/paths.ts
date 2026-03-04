import { homedir } from "node:os";
import { join } from "node:path";

export function resolveClineDataDir(): string {
	const explicitDir = process.env.CLINE_DATA_DIR?.trim();
	if (explicitDir) {
		return explicitDir;
	}
	return join(homedir(), ".cline", "data");
}

export function resolveSessionDataDir(): string {
	const explicitDir = process.env.CLINE_SESSION_DATA_DIR?.trim();
	if (explicitDir) {
		return explicitDir;
	}
	return join(resolveClineDataDir(), "sessions");
}

export function resolveProviderSettingsPath(): string {
	const explicitPath = process.env.CLINE_PROVIDER_SETTINGS_PATH?.trim();
	if (explicitPath) {
		return explicitPath;
	}
	return join(resolveClineDataDir(), "settings", "providers.json");
}
