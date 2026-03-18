/// <reference types="@types/bun" />
export {};

const result = await Bun.build({
	entrypoints: ["./src/index.ts"],
	outdir: "./dist",
	target: "bun",
	format: "esm",
	// Only externalize published packages; bundle private workspace packages (@clinebot/shared, @clinebot/rpc)
	external: ["@clinebot/agents", "@clinebot/core", "@clinebot/llms"],
});

if (result.logs.length > 0) {
	for (const log of result.logs) {
		console.warn(log);
	}
}
