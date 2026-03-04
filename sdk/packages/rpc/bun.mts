/// <reference types="@types/bun" />
export {};

const builds = [
	{
		entrypoints: ["./src/index.ts"],
		outdir: "./dist",
		target: "node",
		format: "esm",
		packages: "external",
		minify: true,
		sourcemap: "none",
	},
	{
		entrypoints: ["./src/index.browser.ts"],
		outdir: "./dist",
		target: "browser",
		format: "esm",
		packages: "external",
		minify: true,
		sourcemap: "none",
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
