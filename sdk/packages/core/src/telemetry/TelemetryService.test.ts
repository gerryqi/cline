import { describe, expect, it, vi } from "vitest";
import type { ITelemetryAdapter } from "./ITelemetryAdapter";
import { TelemetryService } from "./TelemetryService";

describe("TelemetryService", () => {
	it("merges metadata and forwards calls to adapters", async () => {
		const { adapter, emit, recordCounter } = createAdapter();
		const service = new TelemetryService({
			adapters: [adapter],
			metadata: {
				extension_version: "1.2.3",
				cline_type: "cli",
			},
			distinctId: "distinct-1",
			commonProperties: {
				organization_id: "org-1",
			},
		});

		service.capture({
			event: "session.started",
			properties: { sessionId: "session-1" },
		});
		service.recordCounter("cline.session.starts.total", 1, {
			sessionId: "session-1",
		});
		await service.flush();
		await service.dispose();

		expect(emit).toHaveBeenCalledWith(
			"session.started",
			expect.objectContaining({
				sessionId: "session-1",
				organization_id: "org-1",
				extension_version: "1.2.3",
				cline_type: "cli",
				distinct_id: "distinct-1",
			}),
		);
		expect(recordCounter).toHaveBeenCalledWith(
			"cline.session.starts.total",
			1,
			expect.objectContaining({
				sessionId: "session-1",
				distinct_id: "distinct-1",
			}),
			undefined,
			false,
		);
	});
});

function createAdapter(): {
	adapter: ITelemetryAdapter;
	emit: ReturnType<typeof vi.fn>;
	recordCounter: ReturnType<typeof vi.fn>;
} {
	const emit = vi.fn();
	const recordCounter = vi.fn();
	return {
		adapter: {
			name: "test",
			emit,
			emitRequired: vi.fn(),
			recordCounter,
			recordHistogram: vi.fn(),
			recordGauge: vi.fn(),
			isEnabled: vi.fn(() => true),
			flush: vi.fn().mockResolvedValue(undefined),
			dispose: vi.fn().mockResolvedValue(undefined),
		},
		emit,
		recordCounter,
	};
}
