#!/usr/bin/env bun

// bun ./scripts/deps.ts prepare
// bun ./scripts/deps.ts restore
// bun ./scripts/deps.ts dry-run

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type PackageJson = {
	name?: string;
	version?: string;
	workspaces?: string[];
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliDir = path.resolve(__dirname, "..");
const repoDir = path.resolve(cliDir, "..");
const rootPackagePath = path.join(repoDir, "package.json");
const cliPackagePath = path.join(cliDir, "package.json");
const backupPath = path.join(cliDir, ".package.json.workspace-backup");
const command = process.argv[2];

function readJson(filePath: string): PackageJson {
	return JSON.parse(readFileSync(filePath, "utf8")) as PackageJson;
}

function toResolvedRange(workspaceRange: string, version: string): string {
	const suffix = workspaceRange.slice("workspace:".length);

	if (suffix === "*" || suffix === "") {
		return version;
	}

	if (suffix === "^" || suffix === "~") {
		return `${suffix}${version}`;
	}

	return suffix;
}

function isBundledInternalDependency(name: string): boolean {
	return name.startsWith("@cline/");
}

function resolveWorkspaceVersions(): Map<string, string> {
	const root = readJson(rootPackagePath);
	const workspaces = Array.isArray(root.workspaces) ? root.workspaces : [];
	const versions = new Map<string, string>();

	for (const workspace of workspaces) {
		const workspacePackagePath = path.join(repoDir, workspace, "package.json");

		if (!existsSync(workspacePackagePath)) {
			continue;
		}

		const pkg = readJson(workspacePackagePath);
		if (typeof pkg.name === "string" && typeof pkg.version === "string") {
			versions.set(pkg.name, pkg.version);
		}
	}

	return versions;
}

function collectPublishChanges(
	pkg: PackageJson,
	versions: Map<string, string>,
): string[] {
	const sections: Array<[string, Record<string, string> | undefined]> = [
		["dependencies", pkg.dependencies],
		["devDependencies", pkg.devDependencies],
		["peerDependencies", pkg.peerDependencies],
		["optionalDependencies", pkg.optionalDependencies],
	];
	const changes: string[] = [];

	for (const [sectionName, deps] of sections) {
		if (!deps) {
			continue;
		}

		for (const [name, range] of Object.entries(deps)) {
			if (sectionName === "dependencies" && isBundledInternalDependency(name)) {
				changes.push(`${sectionName}.${name}: ${range} -> (removed)`);
				continue;
			}

			if (!range.startsWith("workspace:")) {
				continue;
			}

			const version = versions.get(name);
			if (!version) {
				throw new Error(
					`Cannot resolve workspace version for dependency "${name}"`,
				);
			}

			const resolved = toResolvedRange(range, version);
			if (resolved !== range) {
				changes.push(`${sectionName}.${name}: ${range} -> ${resolved}`);
			}
		}
	}

	return changes;
}

function applyPublishTransforms(
	pkg: PackageJson,
	versions: Map<string, string>,
): void {
	const sections: Array<[string, Record<string, string> | undefined]> = [
		["dependencies", pkg.dependencies],
		["devDependencies", pkg.devDependencies],
		["peerDependencies", pkg.peerDependencies],
		["optionalDependencies", pkg.optionalDependencies],
	];

	for (const [sectionName, deps] of sections) {
		if (!deps) {
			continue;
		}

		for (const [name, range] of Object.entries(deps)) {
			if (sectionName === "dependencies" && isBundledInternalDependency(name)) {
				delete deps[name];
				continue;
			}

			if (!range.startsWith("workspace:")) {
				continue;
			}

			const version = versions.get(name);
			if (!version) {
				throw new Error(
					`Cannot resolve workspace version for dependency "${name}"`,
				);
			}

			deps[name] = toResolvedRange(range, version);
		}
	}
}

function runPrepare(): void {
	if (existsSync(backupPath)) {
		throw new Error(
			`Backup already exists at ${backupPath}; run restore first`,
		);
	}

	const originalText = readFileSync(cliPackagePath, "utf8");
	writeFileSync(backupPath, originalText, "utf8");

	const pkg = JSON.parse(originalText) as PackageJson;
	const versions = resolveWorkspaceVersions();
	applyPublishTransforms(pkg, versions);
	writeFileSync(cliPackagePath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
}

function runRestore(): void {
	if (!existsSync(backupPath)) {
		return;
	}

	const originalText = readFileSync(backupPath, "utf8");
	writeFileSync(cliPackagePath, originalText, "utf8");
	unlinkSync(backupPath);
}

function runDryRun(): void {
	const pkg = readJson(cliPackagePath);
	const versions = resolveWorkspaceVersions();
	const changes = collectPublishChanges(pkg, versions);

	if (changes.length === 0) {
		console.log("No publish-time dependency changes needed.");
		return;
	}

	console.log("Would apply the following publish-time dependency changes:");
	for (const change of changes) {
		console.log(`- ${change}`);
	}
}

if (command === "prepare") {
	runPrepare();
} else if (command === "restore") {
	runRestore();
} else if (command === "dry-run") {
	runDryRun();
} else {
	console.error(
		"Usage: bun ./scripts/rewrite-workspace-deps.ts <prepare|restore|dry-run>",
	);
	process.exit(1);
}
