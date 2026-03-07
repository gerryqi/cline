#!/usr/bin/env -S node --no-deprecation

import { runCli } from "./main";
import { abortActiveRuntime } from "./runtime/active-runtime";
import { writeErr } from "./utils/output";

runCli().catch((err) => {
	writeErr(err instanceof Error ? err.message : String(err));
	abortActiveRuntime();
	process.exit(1);
});
