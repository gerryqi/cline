import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
	"packages/agents/vitest.config.ts",
	"packages/core/vitest.config.ts",
	"packages/llms/vitest.config.ts",
	"apps/cli/vitest.config.ts",
]);
