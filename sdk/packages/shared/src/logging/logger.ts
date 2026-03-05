export interface BasicLogger {
	debug?: (message: string, metadata?: Record<string, unknown>) => void;
	info?: (message: string, metadata?: Record<string, unknown>) => void;
	warn?: (message: string, metadata?: Record<string, unknown>) => void;
	error?: (
		message: string,
		metadata?: Record<string, unknown> & { error?: unknown },
	) => void;
}
