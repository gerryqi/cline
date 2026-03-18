#!/usr/bin/env bun

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
	args: Bun.argv.slice(2),
	options: {
		dry: { type: "boolean", default: false },
	},
	allowPositionals: true,
	strict: true,
});

const version = positionals[0];
if (!version) {
	console.error("Usage: bun scripts/version.ts <version> [--dry]");
	console.error("Example: bun scripts/version.ts 1.2.3");
	process.exit(1);
}

if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
	console.error(`Invalid semver version: ${version}`);
	process.exit(1);
}

const root = join(import.meta.dir, "..");
const packagesDir = join(root, "packages");

const dirs = await readdir(packagesDir, { withFileTypes: true });
const workspaces = dirs.filter((d) => d.isDirectory()).map((d) => d.name);

let updated = 0;

for (const workspace of workspaces) {
	const pkgPath = join(packagesDir, workspace, "package.json");
	try {
		const raw = await readFile(pkgPath, "utf-8");
		const pkg = JSON.parse(raw);
		const oldVersion = pkg.version;
		pkg.version = version;
		const out = `${JSON.stringify(pkg, null, "\t")}\n`;

		if (values.dry) {
			console.log(`[dry] ${pkg.name}: ${oldVersion} → ${version}`);
		} else {
			await writeFile(pkgPath, out);
			console.log(`${pkg.name}: ${oldVersion} → ${version}`);
		}
		updated++;
	} catch {
		// skip directories without a package.json
	}
}

console.log(
	`\n${values.dry ? "[dry] " : ""}Updated ${updated} package(s) to v${version}`,
);
