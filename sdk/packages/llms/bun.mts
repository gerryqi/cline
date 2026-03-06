/// <reference types="@types/bun" />
export {};

const builds = [
	{
		entrypoints: ["./src/index.ts"] as string[],
		outdir: "./dist",
		target: "node" as const,
		packages: "external" as const,
		minify: true,
		sourcemap: "none",
	},
	{
		entrypoints: ["./src/index.browser.ts"] as string[],
		outdir: "./dist",
		target: "browser" as const,
		packages: "external" as const,
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
