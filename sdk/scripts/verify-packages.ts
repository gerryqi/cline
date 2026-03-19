#!/usr/bin/env bun

/**
 * Verifies that published SDK packages are installable and importable after
 * running `bun scripts/version.ts <version> --publish`.
 *
 * This catches the class of bugs where workspace:* deps leak into the
 * published package.json, or where bundled internal packages are incorrectly
 * listed as external dependencies.
 *
 * Steps:
 *   1. Validate no workspace:* deps remain in published packages
 *   2. Pack each published package into a tarball (npm pack)
 *   3. Install all tarballs together into an isolated temp directory (with full dep tree)
 *   4. Dynamically import each package's main export to verify it loads
 */

import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const packagesDir = join(root, "packages");
const publishVerifyBackupPath = join(
	root,
	".publish-verify-package-json-backup.json",
);

async function restorePublishVerifyBackup(): Promise<void> {
	try {
		const raw = await readFile(publishVerifyBackupPath, "utf-8");
		const backups = JSON.parse(raw) as Record<string, string>;
		for (const [filePath, contents] of Object.entries(backups)) {
			await writeFile(filePath, contents);
		}
	} catch (error: unknown) {
		if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
			throw error;
		}
	} finally {
		await rm(publishVerifyBackupPath, { force: true });
	}
}

// Discover published (non-internal) packages
const dirs = await readdir(packagesDir, { withFileTypes: true });
const published: { name: string; dir: string; workspace: string }[] = [];

for (const d of dirs) {
	if (!d.isDirectory()) continue;
	const pkgPath = join(packagesDir, d.name, "package.json");
	try {
		const pkg = JSON.parse(await readFile(pkgPath, "utf-8"));
		if (!pkg.internal) {
			published.push({
				name: pkg.name,
				dir: join(packagesDir, d.name),
				workspace: d.name,
			});
		}
	} catch {
		// skip
	}
}

if (published.length === 0) {
	console.error("No published packages found");
	await restorePublishVerifyBackup();
	process.exit(1);
}

console.log(
	`Found ${published.length} published package(s): ${published.map((p) => p.name).join(", ")}\n`,
);

// --- Step 1: Validate package.json for leaked workspace deps ---
console.log("--- Checking for leaked workspace:* dependencies ---");
let hasLeaks = false;

for (const pkg of published) {
	const raw = JSON.parse(
		await readFile(join(pkg.dir, "package.json"), "utf-8"),
	);
	for (const depType of [
		"dependencies",
		"peerDependencies",
		"optionalDependencies",
	] as const) {
		for (const [dep, ver] of Object.entries(
			(raw[depType] ?? {}) as Record<string, string>,
		)) {
			if (ver === "workspace:*" || ver.startsWith("workspace:")) {
				console.error(
					`  FAIL ${pkg.name} → ${depType}.${dep} = "${ver}" (workspace protocol not supported by npm)`,
				);
				hasLeaks = true;
			}
		}
	}
}

if (hasLeaks) {
	console.error(
		"\nworkspace:* dependencies detected in published packages. Run `bun scripts/version.ts <version> --publish` first.",
	);
	await restorePublishVerifyBackup();
	process.exit(1);
}
console.log("  OK — no workspace protocol leaks\n");

const testDir = await mkdtemp(join(tmpdir(), "cline-pkg-verify-"));
const npmCacheDir = join(testDir, ".npm-cache");
await mkdir(npmCacheDir, { recursive: true });

function npmEnv() {
	return {
		...process.env,
		npm_config_cache: npmCacheDir,
	};
}

async function runCommand(
	cmd: string[],
	options: { cwd: string },
): Promise<string> {
	const proc = Bun.spawn(cmd, {
		cwd: options.cwd,
		env: npmEnv(),
		stdout: "pipe",
		stderr: "pipe",
	});
	const exitCode = await proc.exited;
	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	if (exitCode !== 0) {
		throw new Error(
			stderr || stdout || `${cmd[0]} exited with code ${exitCode}`,
		);
	}
	return stdout;
}

async function cleanup() {
	await rm(testDir, { recursive: true, force: true });
	for (const t of tarballs) {
		await rm(t.tarball, { force: true });
	}
}

const tarballs: { name: string; tarball: string }[] = [];
let exitCode = 0;

try {
	// --- Step 2: Pack each package ---
	console.log("--- Packing tarballs ---");
	for (const pkg of published) {
		const result = await runCommand(
			["npm", "pack", "--pack-destination", root],
			{ cwd: pkg.dir },
		);
		const tarballName = result.trim().split("\n").pop()!;
		const tarball = join(root, tarballName);
		tarballs.push({ name: pkg.name, tarball });
		console.log(`  ${pkg.name} → ${tarballName}`);
	}

	// --- Step 3: Install tarballs into an isolated directory ---
	console.log("\n--- Installing packages in isolated directory ---");
	const testPkg = {
		name: "cline-pkg-verify",
		private: true,
		type: "module",
		dependencies: Object.fromEntries(tarballs.map((t) => [t.name, t.tarball])),
	};
	await writeFile(
		join(testDir, "package.json"),
		JSON.stringify(testPkg, null, 2),
	);

	await runCommand(["npm", "install", "--ignore-scripts"], {
		cwd: testDir,
	});
	console.log("  OK — npm install succeeded\n");

	// --- Step 4: Try resolving each package's main entry ---
	console.log("--- Verifying module resolution ---");
	let importFailed = false;
	for (const pkg of published) {
		const testFile = join(testDir, `test-${pkg.workspace}.ts`);
		await writeFile(
			testFile,
			[
				`try {`,
				`  await import("${pkg.name}");`,
				`  console.log("  OK ${pkg.name}");`,
				`} catch (e: any) {`,
				`  console.error("  FAIL ${pkg.name}:", e.message);`,
				`  if (e.code) console.error("       code:", e.code);`,
				`  process.exitCode = 1;`,
				`}`,
			].join("\n"),
		);
		try {
			const proc = Bun.spawn(["bun", testFile], {
				cwd: testDir,
				stdout: "pipe",
				stderr: "pipe",
			});
			const result = await Promise.race([
				proc.exited,
				new Promise<never>((_, reject) =>
					setTimeout(() => {
						proc.kill();
						reject(new Error("timed out after 30s"));
					}, 30_000),
				),
			]);
			const stdout = await new Response(proc.stdout).text();
			const stderr = await new Response(proc.stderr).text();
			const output = (stdout + stderr).trim();
			if (output) console.log(output);
			if (result !== 0 || output.includes("FAIL")) {
				importFailed = true;
			}
		} catch (e: unknown) {
			importFailed = true;
			const msg = e instanceof Error ? e.message : String(e);
			console.error(`  FAIL — could not import ${pkg.name}: ${msg}`);
		}
	}

	console.log("\n--- Verifying publish-only package invariants ---");
	for (const pkg of published) {
		if (pkg.name !== "@clinebot/core") {
			continue;
		}

		const testFile = join(testDir, `test-${pkg.workspace}-publish-shape.ts`);
		await writeFile(
			testFile,
			[
				`import { readFileSync } from "node:fs";`,
				`import { join } from "node:path";`,
				`const pkgJson = JSON.parse(readFileSync(join(process.cwd(), "node_modules", "@clinebot", "core", "package.json"), "utf8"));`,
				`try {`,
				`  if (pkgJson.dependencies?.["better-sqlite3"] !== "^11.10.0") {`,
				`    console.error("  FAIL @clinebot/core: package.json is missing runtime dependency better-sqlite3");`,
				`    process.exit(1);`,
				`  }`,
				`  const root = await import("@clinebot/core");`,
				`  const node = await import("@clinebot/core/node");`,
				`  if (typeof root.createSessionHost !== "function") {`,
				`    console.error("  FAIL @clinebot/core: root export is missing createSessionHost");`,
				`    process.exit(1);`,
				`  }`,
				`  if (typeof node.createSessionHost !== "function") {`,
				`    console.error("  FAIL @clinebot/core: ./node export is missing createSessionHost");`,
				`    process.exit(1);`,
				`  }`,
				`} catch (error) {`,
				`  const message = error instanceof Error ? error.message : String(error);`,
				`  console.error("  FAIL @clinebot/core: published runtime shape is invalid:", message);`,
				`  process.exit(1);`,
				`}`,
				`console.log("  OK @clinebot/core publish shape");`,
			].join("\n"),
		);
		try {
			const proc = Bun.spawn(["bun", testFile], {
				cwd: testDir,
				stdout: "pipe",
				stderr: "pipe",
			});
			const result = await Promise.race([
				proc.exited,
				new Promise<never>((_, reject) =>
					setTimeout(() => {
						proc.kill();
						reject(new Error("timed out after 30s"));
					}, 30_000),
				),
			]);
			const stdout = await new Response(proc.stdout).text();
			const stderr = await new Response(proc.stderr).text();
			const output = (stdout + stderr).trim();
			if (output) console.log(output);
			if (result !== 0 || output.includes("FAIL")) {
				importFailed = true;
			}
		} catch (e: unknown) {
			importFailed = true;
			const msg = e instanceof Error ? e.message : String(e);
			console.error(
				`  FAIL — could not verify publish shape for ${pkg.name}: ${msg}`,
			);
		}
	}

	if (importFailed) {
		console.error("\nSome packages failed to import.");
		exitCode = 1;
	} else {
		console.log("\nAll packages verified successfully.");
	}
} catch (e: unknown) {
	exitCode = 1;
	const msg = e instanceof Error ? e.message : String(e);
	console.error(`\nVerification failed:\n${msg}`);
} finally {
	await cleanup();
	await restorePublishVerifyBackup();
}

process.exit(exitCode);
