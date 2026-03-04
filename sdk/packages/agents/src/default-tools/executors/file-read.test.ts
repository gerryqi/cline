import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { createFileReadExecutor } from "./file-read.js";

describe("createFileReadExecutor", () => {
	it("reads a file from an absolute path", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agents-file-read-"));
		const filePath = path.join(dir, "example.txt");
		await fs.writeFile(filePath, "hello absolute path", "utf-8");

		try {
			const readFile = createFileReadExecutor();
			const result = await readFile(filePath, {
				agentId: "agent-1",
				conversationId: "conv-1",
				iteration: 1,
			});
			expect(result).toBe("hello absolute path");
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});
});
