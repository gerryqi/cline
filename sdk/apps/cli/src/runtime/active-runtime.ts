let activeRuntimeAbort: (() => void) | undefined;

export function setActiveRuntimeAbort(abortFn: (() => void) | undefined): void {
	activeRuntimeAbort = abortFn;
}

export function abortActiveRuntime(): void {
	try {
		activeRuntimeAbort?.();
	} catch {
		// Best-effort abort path.
	}
}
