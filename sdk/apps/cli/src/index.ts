#!/usr/bin/env bun

import { isMainThread } from "node:worker_threads";
import { flushCliLoggerAdapters } from "./logging/adapter";
import { runCli } from "./main";
import { abortActiveRuntime } from "./runtime/active-runtime";
import { writeErr } from "./utils/output";
import { disposeCliTelemetryService } from "./utils/telemetry";

if (!isMainThread) {
	// Worker imports of the bundled CLI entrypoint should not start the CLI.
} else {
	process.once("exit", () => {
		flushCliLoggerAdapters();
	});

	runCli().catch((err) => {
		writeErr(err instanceof Error ? err.message : String(err));
		abortActiveRuntime();
		void disposeCliTelemetryService();
		flushCliLoggerAdapters();
		process.exit(1);
	});
}
