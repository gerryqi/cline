export interface HookSessionContext {
	rootSessionId?: string;
	hookLogPath?: string;
}

export interface HookSessionContextLookup {
	hookName?: string;
	conversationId?: string;
	agentId?: string;
	parentAgentId?: string | null;
}

export type HookSessionContextProvider =
	| HookSessionContext
	| ((input?: HookSessionContextLookup) => HookSessionContext | undefined);

function normalized(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

export function resolveHookSessionContext(
	provider?: HookSessionContextProvider,
	input?: HookSessionContextLookup,
): HookSessionContext | undefined {
	if (!provider) {
		return undefined;
	}
	const context = typeof provider === "function" ? provider(input) : provider;
	if (!context) {
		return undefined;
	}
	const rootSessionId = normalized(context.rootSessionId);
	const hookLogPath = normalized(context.hookLogPath);
	if (!rootSessionId && !hookLogPath) {
		return undefined;
	}
	return {
		rootSessionId,
		hookLogPath,
	};
}

export function resolveRootSessionId(
	context: HookSessionContext | undefined,
): string | undefined {
	return normalized(context?.rootSessionId);
}

export function resolveHookLogPath(
	context: HookSessionContext | undefined,
): string | undefined {
	return normalized(context?.hookLogPath);
}
