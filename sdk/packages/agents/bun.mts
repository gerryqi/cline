/// <reference types="@types/bun" />
export {};

const builds: Parameters<typeof Bun.build>[0][] = [
	{
		entrypoints: ["./src/index.ts"],
		outdir: "./dist",
		target: "node",
		minify: true,
		sourcemap: "none",
		external: ["@cline/llms", "@cline/shared"],
	},
	{
		entrypoints: ["./src/index.node.ts"],
		outdir: "./dist",
		target: "node",
		minify: true,
		sourcemap: "none",
		external: ["@cline/llms", "@cline/shared"],
	},
	{
		entrypoints: ["./src/index.browser.ts"],
		outdir: "./dist",
		target: "browser",
		minify: true,
		sourcemap: "none",
		external: ["@cline/llms", "@cline/shared"],
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
