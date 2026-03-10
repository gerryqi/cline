/// <reference types="@types/bun" />
export {};

const result = await Bun.build({
	entrypoints: ["./src/index.ts"],
	outdir: "./dist",
	target: "node",
	format: "esm",
	packages: "external",
	minify: true,
	sourcemap: "none",
});

if (result.logs.length > 0) {
	for (const log of result.logs) {
		console.warn(log);
	}
}
