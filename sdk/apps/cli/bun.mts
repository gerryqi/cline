/// <reference types="@types/bun" />
export {};

const result = await Bun.build({
	entrypoints: ["./src/index.ts"],
	outdir: "./dist",
	target: "bun",
	format: "esm",
	external: [
		"@cline/agents",
		"@cline/core",
		"@cline/llms",
		"@cline/rpc",
		"@cline/shared",
	],
});

if (result.logs.length > 0) {
	for (const log of result.logs) {
		console.warn(log);
	}
}
