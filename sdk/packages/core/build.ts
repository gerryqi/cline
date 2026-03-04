/// <reference types="@types/bun" />
export {};

const external = [
	"@cline/agents",
	"@cline/shared",
	"@cline/llms",
	"@cline/rpc",
];

const builds = [
	{
		entrypoints: ["./src/index.ts"],
		outdir: "./dist",
		format: "esm",
		minify: true,
		sourcemap: "none",
		external,
	},
	{
		entrypoints: ["./src/server/index.ts"],
		outdir: "./dist/server",
		target: "node",
		minify: true,
		sourcemap: "none",
		external,
	},
];

for (const config of builds) {
	const result = await Bun.build(config as Parameters<typeof Bun.build>[0]);

	if (result.logs.length > 0) {
		for (const log of result.logs) {
			console.warn(log);
		}
	}
}
