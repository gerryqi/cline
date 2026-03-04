import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { enrichPromptWithMentions } from "./mention-enricher";

async function createTempWorkspace(): Promise<string> {
	return mkdtemp(path.join(os.tmpdir(), "core-mentions-"));
}

describe("enrichPromptWithMentions", () => {
	it("attaches content for matching @path mentions", async () => {
		const cwd = await createTempWorkspace();
		try {
			const sourcePath = path.join(cwd, "src", "index.ts");
			await mkdir(path.dirname(sourcePath), { recursive: true });
			await writeFile(sourcePath, "export const answer = 42\n", "utf8");

			const result = await enrichPromptWithMentions(
				"Review @src/index.ts",
				cwd,
			);

			expect(result.matchedFiles).toEqual(["src/index.ts"]);
			expect(result.ignoredMentions).toEqual([]);
			expect(result.prompt).toContain('<file_content path="src/index.ts">');
			expect(result.prompt).toContain("export const answer = 42");
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	it("ignores emails and unmatched mentions", async () => {
		const cwd = await createTempWorkspace();
		try {
			await writeFile(path.join(cwd, "README.md"), "# Demo\n", "utf8");

			const result = await enrichPromptWithMentions(
				"Ping me at test@example.com and check @missing/file.ts.",
				cwd,
			);

			expect(result.matchedFiles).toEqual([]);
			expect(result.ignoredMentions).toEqual(["missing/file.ts"]);
			expect(result.prompt).not.toContain("<file_content");
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});

	it("respects maxFiles while keeping matched files", async () => {
		const cwd = await createTempWorkspace();
		try {
			await writeFile(path.join(cwd, "a.ts"), "const a = 1\n", "utf8");
			await writeFile(path.join(cwd, "b.ts"), "const b = 2\n", "utf8");

			const result = await enrichPromptWithMentions(
				"Use @a.ts and @b.ts",
				cwd,
				{ maxFiles: 1 },
			);

			expect(result.matchedFiles).toEqual(["a.ts"]);
			expect(result.ignoredMentions).toEqual(["b.ts"]);
			expect(result.prompt).toContain('path="a.ts"');
			expect(result.prompt).not.toContain('path="b.ts"');
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});
});
