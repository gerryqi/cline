#!/usr/bin/env -S node --no-deprecation

import { flushCliLoggerAdapters } from "./logging/adapter";
import { runCli } from "./main";
import { abortActiveRuntime } from "./runtime/active-runtime";
import { writeErr } from "./utils/output";

process.once("beforeExit", () => {
	flushCliLoggerAdapters();
});
process.once("exit", () => {
	flushCliLoggerAdapters();
});

runCli().catch((err) => {
	writeErr(err instanceof Error ? err.message : String(err));
	abortActiveRuntime();
	flushCliLoggerAdapters();
	process.exit(1);
});
