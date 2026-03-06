import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { getFileIndex, prewarmFileIndex } from "./file-indexer";

vi.mock("node:worker_threads", async () => {
	const actual = await vi.importActual<typeof import("node:worker_threads")>(
		"node:worker_threads",
	);
	return {
		...actual,
		isMainThread: false,
		parentPort: null,
	};
});

async function createTempWorkspace(): Promise<string> {
	return mkdtemp(path.join(os.tmpdir(), "core-file-index-"));
}

describe("file indexer", () => {
	it("indexes files by relative posix path", async () => {
		const cwd = await createTempWorkspace();
		try {
			await mkdir(path.join(cwd, "src"), { recursive: true });
			await writeFile(path.join(cwd, "src", "main.ts"), "export {}\n", "utf8");
			await writeFile(path.join(cwd, "README.md"), "# Demo\n", "utf8");

			const index = await getFileIndex(cwd, { ttlMs: 0 });
			expect(index.has("src/main.ts")).toBe(true);
			expect(index.has("README.md")).toBe(true);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	it("always excludes .git files from index", async () => {
		const cwd = await createTempWorkspace();
		try {
			await mkdir(path.join(cwd, ".git"), { recursive: true });
			await mkdir(path.join(cwd, "node_modules", "pkg"), { recursive: true });
			await writeFile(path.join(cwd, ".git", "config"), "[core]\n", "utf8");
			await writeFile(
				path.join(cwd, "node_modules", "pkg", "index.js"),
				"module.exports = {}\n",
				"utf8",
			);
			await writeFile(
				path.join(cwd, "app.ts"),
				"export const app = 1\n",
				"utf8",
			);

			const index = await getFileIndex(cwd, { ttlMs: 0 });
			expect(index.has("app.ts")).toBe(true);
			expect(index.has(".git/config")).toBe(false);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	it("prewarm rebuilds index and includes new files", async () => {
		const cwd = await createTempWorkspace();
		try {
			await writeFile(
				path.join(cwd, "first.ts"),
				"export const first = 1\n",
				"utf8",
			);
			const firstIndex = await getFileIndex(cwd, { ttlMs: 60_000 });
			expect(firstIndex.has("first.ts")).toBe(true);

			await writeFile(
				path.join(cwd, "second.ts"),
				"export const second = 2\n",
				"utf8",
			);
			await prewarmFileIndex(cwd, { ttlMs: 60_000 });

			const rebuilt = await getFileIndex(cwd, { ttlMs: 60_000 });
			expect(rebuilt.has("second.ts")).toBe(true);
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});
});
