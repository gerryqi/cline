import { describe, expect, it, vi } from "vitest";
import { LoggerTelemetryAdapter } from "./LoggerTelemetryAdapter";

describe("LoggerTelemetryAdapter", () => {
	it("logs events and metrics through the provided logger", async () => {
		const logger = {
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
		};
		const adapter = new LoggerTelemetryAdapter({ logger });

		adapter.emit("session.started", { sessionId: "s1" });
		adapter.emitRequired("user.opt_out", { reason: "manual" });
		adapter.recordCounter("cline.session.starts.total", 1, {
			sessionId: "s1",
		});

		expect(logger.info).toHaveBeenCalledWith("telemetry.event", {
			adapter: "LoggerTelemetryAdapter",
			event: "session.started",
			properties: { sessionId: "s1" },
		});
		expect(logger.warn).toHaveBeenCalledWith("telemetry.required_event", {
			adapter: "LoggerTelemetryAdapter",
			event: "user.opt_out",
			properties: { reason: "manual" },
		});
		expect(logger.debug).toHaveBeenCalledWith("telemetry.metric", {
			adapter: "LoggerTelemetryAdapter",
			instrument: "counter",
			name: "cline.session.starts.total",
			value: 1,
			attributes: { sessionId: "s1" },
			description: undefined,
			required: false,
		});

		await adapter.flush();
		await adapter.dispose();
	});
});
