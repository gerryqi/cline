import { $ } from "bun";

const main = async () => {
	await $`next build`;
};

main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
