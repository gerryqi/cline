/// <reference types="@types/bun" />
export {};

const result = await Bun.build({
	entrypoints: ["./src/index.ts"],
	outdir: "./dist",
	target: "bun",
	format: "esm",
	packages: "bundle", // Keep private workspace packages bundled so npm consumers do not need @clinebot/* at runtime.
	banner:
		'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
});

if (result.logs.length > 0) {
	for (const log of result.logs) {
		console.warn(log);
	}
}
