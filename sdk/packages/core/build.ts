/// <reference types="@types/bun" />
export {};

// Only externalize published packages; bundle private workspace packages (@clinebot/shared, @clinebot/rpc)
const external = [
	"@clinebot/agents",
	"@clinebot/llms",
	"nanoid",
	"simple-git",
	"yaml",
	"zod",
];

const builds: Parameters<typeof Bun.build>[0][] = [
	{
		entrypoints: ["./src/index.node.ts"],
		outdir: "./dist",
		target: "node",
		format: "esm",
		minify: true,
		sourcemap: "none",
		external,
	},
	{
		entrypoints: ["./src/index.browser.ts"],
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
