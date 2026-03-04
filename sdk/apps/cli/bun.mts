const result = await Bun.build({
	entrypoints: ["./src/index.ts"],
	outdir: "./dist",
	target: "node",
	format: "esm",
	external: ["@cline/agents", "@cline/core", "@cline/llms", "@cline/rpc"],
});

if (result.logs.length > 0) {
	for (const log of result.logs) {
		console.warn(log);
	}
}
