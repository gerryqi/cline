import { describe, expect, it, vi } from "vitest";
import {
	calculateRetryDelay,
	isRetriableError,
	RetriableError,
	retryAsync,
	withRetry,
} from "./retry";

describe("retry utils", () => {
	it("detects retriable errors from known patterns", () => {
		expect(isRetriableError(new RetriableError("try again"))).toBe(true);
		expect(isRetriableError(new Error("HTTP 429: Too Many Requests"))).toBe(
			true,
		);
		expect(isRetriableError(new Error("upstream 503 failure"))).toBe(true);
		expect(isRetriableError(new Error("network timeout occurred"))).toBe(true);
		expect(isRetriableError(new Error("validation failed"))).toBe(false);
		expect(isRetriableError("not-an-error")).toBe(false);
	});

	it("calculates exponential delay with jitter and max cap", () => {
		const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);

		const noJitter = calculateRetryDelay(2, { baseDelay: 10, maxDelay: 1000 });
		expect(noJitter).toBe(40);

		randomSpy.mockReturnValue(1);
		const capped = calculateRetryDelay(10, { baseDelay: 1000, maxDelay: 1500 });
		expect(capped).toBe(1500);

		randomSpy.mockRestore();
	});

	it("retries async function until success and calls onRetryAttempt", async () => {
		let attempts = 0;
		const onRetryAttempt = vi.fn();

		const value = await retryAsync(
			async () => {
				attempts++;
				if (attempts < 3) {
					throw new RetriableError("retry me");
				}
				return "ok";
			},
			{
				maxRetries: 3,
				baseDelay: 0,
				maxDelay: 0,
				onRetryAttempt,
			},
		);

		expect(value).toBe("ok");
		expect(attempts).toBe(3);
		expect(onRetryAttempt).toHaveBeenCalledTimes(2);
		expect(onRetryAttempt).toHaveBeenNthCalledWith(
			1,
			1,
			3,
			0,
			expect.any(RetriableError),
		);
		expect(onRetryAttempt).toHaveBeenNthCalledWith(
			2,
			2,
			3,
			0,
			expect.any(RetriableError),
		);
	});

	it("respects retry-after seconds for retriable errors", async () => {
		let attempts = 0;
		const onRetryAttempt = vi.fn();

		vi.useFakeTimers();

		const pending = retryAsync(
			async () => {
				attempts++;
				if (attempts === 1) {
					throw new RetriableError("rate limited", 2);
				}
				return "done";
			},
			{
				maxRetries: 2,
				onRetryAttempt,
			},
		);
		await vi.runAllTimersAsync();
		await pending;
		vi.useRealTimers();

		expect(onRetryAttempt).toHaveBeenCalledWith(
			1,
			2,
			2000,
			expect.any(RetriableError),
		);
	});

	it("does not retry non-retriable errors", async () => {
		const fn = vi.fn(async () => {
			throw new Error("bad input");
		});

		await expect(
			retryAsync(fn, {
				maxRetries: 3,
				baseDelay: 0,
				maxDelay: 0,
			}),
		).rejects.toThrow("bad input");
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it("retries decorated async generators and preserves yielded chunks", async () => {
		class RetryHarness {
			attempts = 0;

			async *stream() {
				this.attempts++;
				if (this.attempts < 3) {
					throw new RetriableError("temporary");
				}
				yield { type: "text", text: "hello" };
				yield { type: "done" };
			}
		}

		const descriptor = Object.getOwnPropertyDescriptor(
			RetryHarness.prototype,
			"stream",
		);
		if (!descriptor) {
			throw new Error("missing descriptor for stream");
		}

		const onRetryAttempt = vi.fn();
		const decorated = withRetry({
			maxRetries: 3,
			baseDelay: 0,
			maxDelay: 0,
			onRetryAttempt,
		})(
			RetryHarness.prototype,
			"stream",
			descriptor as TypedPropertyDescriptor<
				(...args: unknown[]) => AsyncGenerator<{ type: string; text?: string }>
			>,
		);
		Object.defineProperty(RetryHarness.prototype, "stream", decorated);

		const harness = new RetryHarness();
		const chunks: Array<{ type: string; text?: string }> = [];
		for await (const chunk of harness.stream()) {
			chunks.push(chunk);
		}

		expect(chunks).toEqual([{ type: "text", text: "hello" }, { type: "done" }]);
		expect(harness.attempts).toBe(3);
		expect(onRetryAttempt).toHaveBeenCalledTimes(2);
	});
});
