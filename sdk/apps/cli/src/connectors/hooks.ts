import { runSubprocessEvent } from "@cline/agents";
import type { ConnectorHookEvent } from "@cline/shared";
import type { CliLoggerAdapter } from "../logging/adapter";

export async function dispatchConnectorHook(
	command: string | undefined,
	hookPayload: ConnectorHookEvent,
	logger: CliLoggerAdapter,
): Promise<void> {
	const trimmed = command?.trim();
	if (!trimmed) {
		return;
	}

	try {
		const shell = process.env.SHELL?.trim() || "sh";
		const result = await runSubprocessEvent(hookPayload, {
			command: [shell, "-lc", trimmed],
			cwd: process.cwd(),
			env: process.env,
		});
		if ((result?.exitCode ?? 0) !== 0) {
			logger.core.warn?.("Connector hook exited non-zero", {
				adapter: hookPayload.adapter,
				event: hookPayload.event,
				code: result?.exitCode,
				stderr: result?.stderr.trim() || undefined,
			});
		}
	} catch (error) {
		logger.core.warn?.("Connector hook dispatch failed", {
			adapter: hookPayload.adapter,
			event: hookPayload.event,
			error,
		});
	}
}
