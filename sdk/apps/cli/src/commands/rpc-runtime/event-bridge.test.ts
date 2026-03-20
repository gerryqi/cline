import { describe, expect, it, vi } from "vitest";
import { subscribeRuntimeEventBridge } from "./event-bridge";

describe("subscribeRuntimeEventBridge", () => {
	it("publishes agent error events to the runtime stream", async () => {
		let listener: ((event: unknown) => void) | undefined;
		const sessionManager = {
			subscribe: vi.fn((cb: (event: unknown) => void) => {
				listener = cb;
				return () => {
					listener = undefined;
				};
			}),
		};
		const publishEvent = vi.fn().mockResolvedValue(undefined);
		const unsubscribe = subscribeRuntimeEventBridge({
			sessionManager: sessionManager as any,
			eventClient: {
				publishEvent,
			} as any,
		});

		listener?.({
			type: "agent_event",
			payload: {
				sessionId: "session-123",
				event: {
					type: "error",
					error: new Error("provider exploded"),
					recoverable: true,
					iteration: 1,
				},
			},
		});

		expect(publishEvent).toHaveBeenCalledWith({
			sessionId: "session-123",
			eventType: "runtime.chat.error",
			payload: {
				message: "provider exploded",
				recoverable: true,
				iteration: 1,
			},
			sourceClientId: "cli-rpc-runtime",
		});

		unsubscribe();
	});
});
