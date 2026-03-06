/**
 * Retry Utilities
 *
 * Provides retry logic with exponential backoff for API calls.
 */

export interface RetryOptions {
	maxRetries?: number;
	baseDelay?: number;
	maxDelay?: number;
	onRetryAttempt?: (
		attempt: number,
		maxRetries: number,
		delay: number,
		error: unknown,
	) => void;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, "onRetryAttempt">> = {
	maxRetries: 4,
	baseDelay: 2000,
	maxDelay: 15000,
};

/**
 * Error that indicates the operation should be retried
 */
export class RetriableError extends Error {
	constructor(
		message: string,
		public readonly retryAfterSeconds?: number,
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = "RetriableError";
	}
}

/**
 * Check if an error is retriable
 */
export function isRetriableError(error: unknown): boolean {
	if (error instanceof RetriableError) {
		return true;
	}

	if (error instanceof Error) {
		const message = error.message.toLowerCase();

		// Rate limit errors
		if (
			message.includes("429") ||
			message.includes("rate limit") ||
			message.includes("too many requests")
		) {
			return true;
		}

		// Server errors (5xx)
		if (
			message.includes("500") ||
			message.includes("502") ||
			message.includes("503") ||
			message.includes("504")
		) {
			return true;
		}

		// Network errors
		if (
			message.includes("network") ||
			message.includes("timeout") ||
			message.includes("econnreset") ||
			message.includes("econnrefused")
		) {
			return true;
		}
	}

	return false;
}

/**
 * Calculate delay for retry attempt with exponential backoff and jitter
 */
export function calculateRetryDelay(
	attempt: number,
	options: RetryOptions = {},
): number {
	const {
		baseDelay = DEFAULT_OPTIONS.baseDelay,
		maxDelay = DEFAULT_OPTIONS.maxDelay,
	} = options;

	// Exponential backoff: 2^attempt * baseDelay
	const exponentialDelay = 2 ** attempt * baseDelay;

	// Add jitter (0-25% of delay)
	const jitter = Math.random() * 0.25 * exponentialDelay;

	// Cap at maxDelay
	return Math.min(exponentialDelay + jitter, maxDelay);
}

/**
 * Sleep for a given number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Decorator for retrying async generator methods
 *
 * Usage:
 * ```typescript
 * class MyHandler {
 *   @withRetry({ maxRetries: 3 })
 *   async *createMessage(...) {
 *     // ...
 *   }
 * }
 * ```
 */
export function withRetry(options: RetryOptions = {}) {
	const wrap = <T extends (...args: any[]) => AsyncGenerator<any, any, any>>(
		originalMethod: T,
	): T =>
		async function* (this: any, ...args: Parameters<T>) {
			const { maxRetries = DEFAULT_OPTIONS.maxRetries, onRetryAttempt } =
				options;

			for (let attempt = 0; attempt <= maxRetries; attempt++) {
				try {
					yield* originalMethod.apply(this, args);
					return;
				} catch (error) {
					const isLastAttempt = attempt === maxRetries;
					const shouldRetry = !isLastAttempt && isRetriableError(error);

					if (!shouldRetry) {
						throw error;
					}

					let delay: number;
					if (error instanceof RetriableError && error.retryAfterSeconds) {
						delay = error.retryAfterSeconds * 1000;
					} else {
						delay = calculateRetryDelay(attempt, options);
					}

					if (onRetryAttempt) {
						onRetryAttempt(attempt + 1, maxRetries, delay, error);
					}

					await sleep(delay);
				}
			}
		} as unknown as T;

	return <T extends (...args: any[]) => AsyncGenerator<any, any, any>>(
		value: T,
		_context: { kind: string },
	): T => wrap(value);
}

/**
 * Wrap an async function with retry logic
 */
export async function retryAsync<T>(
	fn: () => Promise<T>,
	options: RetryOptions = {},
): Promise<T> {
	const { maxRetries = DEFAULT_OPTIONS.maxRetries, onRetryAttempt } = options;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			return await fn();
		} catch (error) {
			const isLastAttempt = attempt === maxRetries;
			const shouldRetry = !isLastAttempt && isRetriableError(error);

			if (!shouldRetry) {
				throw error;
			}

			let delay: number;
			if (error instanceof RetriableError && error.retryAfterSeconds) {
				delay = error.retryAfterSeconds * 1000;
			} else {
				delay = calculateRetryDelay(attempt, options);
			}

			if (onRetryAttempt) {
				onRetryAttempt(attempt + 1, maxRetries, delay, error);
			}

			await sleep(delay);
		}
	}

	// This should never be reached
	throw new Error("Retry logic exhausted without returning or throwing");
}
