import { $ } from "bun";

const main = async () => {
	await $`next build`;
	await $`mkdir -p dist/host`;
	await $`bun build ./host/index.ts --outfile ./dist/host/index.js --target bun`;
};

main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
