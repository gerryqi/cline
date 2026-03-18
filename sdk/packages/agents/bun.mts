/// <reference types="@types/bun" />
export {};

// Only externalize published packages; bundle internal workspace packages used by agents.
const external = ["@clinebot/llms", "zod"];

const builds: Parameters<typeof Bun.build>[0][] = [
	{
		entrypoints: ["./src/index.ts"],
		outdir: "./dist",
		target: "node",
		minify: true,
		sourcemap: "none",
		packages: "bundle",
		external,
	},
	{
		entrypoints: ["./src/index.node.ts"],
		outdir: "./dist",
		target: "node",
		minify: true,
		sourcemap: "none",
		packages: "bundle",
		external,
	},
	{
		entrypoints: ["./src/index.browser.ts"],
		outdir: "./dist",
		target: "browser",
		minify: true,
		sourcemap: "none",
		packages: "bundle",
		external,
	},
];

for (const config of builds) {
	const result = await Bun.build(config);

	if (result.logs.length > 0) {
		for (const log of result.logs) {
			console.warn(log);
		}
	}
}
