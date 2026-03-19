#!/usr/bin/env bun

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values, positionals } = parseArgs({
	args: Bun.argv.slice(2),
	options: {
		dry: { type: "boolean", default: false },
		publish: { type: "boolean", default: false },
	},
	allowPositionals: true,
	strict: true,
});

const version = positionals[0];
if (!version) {
	console.error("Usage: bun scripts/version.ts <version> [--dry] [--publish]");
	console.error("Example: bun scripts/version.ts 1.2.3");
	console.error(
		"  --publish  Prepare for npm: remove 'private', resolve published workspace deps, strip bundled-only deps",
	);
	process.exit(1);
}

if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
	console.error(`Invalid semver version: ${version}`);
	process.exit(1);
}

const root = join(import.meta.dir, "..");
const packagesDir = join(root, "packages");
const publishVerifyBackupPath = join(
	root,
	".publish-verify-package-json-backup.json",
);

const dirs = await readdir(packagesDir, { withFileTypes: true });
const workspaces = dirs.filter((d) => d.isDirectory()).map((d) => d.name);

// Build a set of internal (bundled-only) package names from their package.json "internal" field.
// When --publish is used, workspace:* deps pointing to internal packages are stripped (they're bundled
// into the build output), while deps pointing to published packages are resolved to the concrete version.
const internalPackages = new Set<string>();
const packageJsonBackups: Record<string, string> = {};
for (const workspace of workspaces) {
	try {
		const pkgPath = join(packagesDir, workspace, "package.json");
		const raw = await readFile(pkgPath, "utf-8");
		const pkg = JSON.parse(raw);
		packageJsonBackups[pkgPath] = raw;
		if (pkg.internal) {
			internalPackages.add(pkg.name);
		}
	} catch {
		// skip
	}
}

let updated = 0;

if (values.publish && !values.dry) {
	await writeFile(
		publishVerifyBackupPath,
		`${JSON.stringify(packageJsonBackups, null, "\t")}\n`,
	);
}

for (const workspace of workspaces) {
	const pkgPath = join(packagesDir, workspace, "package.json");
	try {
		const raw = await readFile(pkgPath, "utf-8");
		const pkg = JSON.parse(raw);
		const oldVersion = pkg.version;
		pkg.version = version;

		if (values.publish) {
			delete pkg.private;
			for (const [dep, ver] of Object.entries(
				(pkg.dependencies ?? {}) as Record<string, string>,
			)) {
				if (dep.startsWith("@clinebot/") && ver === "workspace:*") {
					if (!internalPackages.has(dep)) {
						pkg.dependencies[dep] = version;
					} else {
						delete pkg.dependencies[dep];
					}
				}
			}

			if (pkg.name === "@clinebot/core") {
				pkg.main = "./dist/index.node.js";
				pkg.types = "./dist/index.node.d.ts";
				if (pkg.exports?.["."]) {
					pkg.exports["."] = {
						development: "./dist/index.node.js",
						types: "./dist/index.node.d.ts",
						import: "./dist/index.node.js",
					};
				}
			}
		}

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
