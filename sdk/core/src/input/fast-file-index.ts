import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";

const DEFAULT_INDEX_TTL_MS = 15_000;
const DEFAULT_EXCLUDE_DIRS = new Set([
	".git",
	"node_modules",
	"dist",
	"build",
	".next",
	"coverage",
	".turbo",
	".cache",
	"target",
	"out",
]);

interface CacheEntry {
	files: Set<string>;
	lastBuiltAt: number;
	pending: Promise<Set<string>> | null;
}

export interface FastFileIndexOptions {
	ttlMs?: number;
}

const CACHE = new Map<string, CacheEntry>();

function toPosixRelative(cwd: string, absolutePath: string): string {
	return path.relative(cwd, absolutePath).split(path.sep).join("/");
}

async function listFilesWithRg(cwd: string): Promise<Set<string>> {
	const output = await new Promise<string>((resolve, reject) => {
		const child = spawn("rg", ["--files", "--hidden", "-g", "!.git"], {
			cwd,
			stdio: ["ignore", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";

		child.stdout.on("data", (chunk: Buffer | string) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk: Buffer | string) => {
			stderr += chunk.toString();
		});
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) {
				resolve(stdout);
				return;
			}
			reject(new Error(stderr || `rg exited with code ${code}`));
		});
	});

	const files = output
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.map((line) => line.replace(/\\/g, "/"));

	return new Set(files);
}

async function walkDir(
	cwd: string,
	dir: string,
	files: Set<string>,
): Promise<void> {
	const entries = await readdir(dir, { withFileTypes: true });
	for (const entry of entries) {
		const absolutePath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (DEFAULT_EXCLUDE_DIRS.has(entry.name)) {
				continue;
			}
			await walkDir(cwd, absolutePath, files);
			continue;
		}
		if (entry.isFile()) {
			files.add(toPosixRelative(cwd, absolutePath));
		}
	}
}

async function listFilesFallback(cwd: string): Promise<Set<string>> {
	const files = new Set<string>();
	await walkDir(cwd, cwd, files);
	return files;
}

async function buildIndex(cwd: string): Promise<Set<string>> {
	try {
		return await listFilesWithRg(cwd);
	} catch {
		return listFilesFallback(cwd);
	}
}

export async function getFastFileList(
	cwd: string,
	options: FastFileIndexOptions = {},
): Promise<Set<string>> {
	const ttlMs = options.ttlMs ?? DEFAULT_INDEX_TTL_MS;
	const now = Date.now();
	const existing = CACHE.get(cwd);

	if (
		existing &&
		now - existing.lastBuiltAt <= ttlMs &&
		existing.files.size > 0
	) {
		return existing.files;
	}

	if (existing?.pending) {
		return existing.pending;
	}

	const pending = buildIndex(cwd).then((files) => {
		CACHE.set(cwd, {
			files,
			lastBuiltAt: Date.now(),
			pending: null,
		});
		return files;
	});

	CACHE.set(cwd, {
		files: existing?.files ?? new Set<string>(),
		lastBuiltAt: existing?.lastBuiltAt ?? 0,
		pending,
	});

	return pending;
}

export async function prewarmFastFileList(
	cwd: string,
	options: FastFileIndexOptions = {},
): Promise<void> {
	await getFastFileList(cwd, { ...options, ttlMs: 0 });
}
