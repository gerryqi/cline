import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getCliBuildInfo } from "../utils/common";
import { runDevCommand } from "./dev";

describe("runDevCommand", () => {
	const tempDirs: string[] = [];
	const commandName = getCliBuildInfo().name;

	afterEach(() => {
		delete process.env.CLINE_DATA_DIR;
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("opens the log file for dev log", async () => {
		const dataDir = mkdtempSync(
			path.join(os.tmpdir(), `${commandName}-dev-log-test-`),
		);
		tempDirs.push(dataDir);
		process.env.CLINE_DATA_DIR = dataDir;

		const opened: string[] = [];
		const output: string[] = [];
		const errors: string[] = [];

		const code = await runDevCommand(
			["dev", "log"],
			{
				writeln: (text) => {
					output.push(text ?? "");
				},
				writeErr: (text) => {
					errors.push(text);
				},
			},
			{
				openPath: async (target) => {
					opened.push(target);
				},
			},
		);

		const expectedPath = path.join(dataDir, "logs", `${commandName}.log`);
		expect(code).toBe(0);
		expect(errors).toHaveLength(0);
		expect(opened).toEqual([expectedPath]);
		expect(output).toEqual([expectedPath]);
		expect(existsSync(expectedPath)).toBe(true);
	});

	it("returns an error for unknown dev subcommands", async () => {
		const errors: string[] = [];
		const code = await runDevCommand(["dev", "unknown"], {
			writeln: () => {},
			writeErr: (text) => {
				errors.push(text);
			},
		});
		expect(code).toBe(1);
		expect(errors).toEqual(['unknown dev subcommand "unknown"']);
	});

	it("returns an error if opening log file fails", async () => {
		const dataDir = mkdtempSync(
			path.join(os.tmpdir(), `${commandName}-dev-log-test-`),
		);
		tempDirs.push(dataDir);
		process.env.CLINE_DATA_DIR = dataDir;

		const errors: string[] = [];
		const code = await runDevCommand(
			["dev", "log"],
			{
				writeln: () => {},
				writeErr: (text) => {
					errors.push(text);
				},
			},
			{
				openPath: async () => {
					throw new Error("open failed");
				},
			},
		);

		expect(code).toBe(1);
		expect(errors[0]).toContain("failed to open log file");
		expect(errors[0]).toContain("open failed");
	});
});
