import { afterEach, describe, expect, it, vi } from "vitest";

const originalArgv = [...process.argv];
const originalStdinIsTTY = process.stdin.isTTY;
const mockState = vi.hoisted(() => ({
	runAgentImports: 0,
	runInteractiveImports: 0,
	runAgentCalls: 0,
}));

describe("runCli lightweight command dispatch", () => {
	afterEach(() => {
		process.argv = [...originalArgv];
		Object.defineProperty(process.stdin, "isTTY", {
			value: originalStdinIsTTY,
			configurable: true,
		});
		vi.restoreAllMocks();
		vi.resetModules();
	});

	it("does not load runtime modules for sessions list", async () => {
		mockState.runAgentImports = 0;
		mockState.runInteractiveImports = 0;

		vi.mock("./runtime/run-agent", () => {
			mockState.runAgentImports += 1;
			return {
				runAgent: vi.fn(),
			};
		});
		vi.mock("./runtime/run-interactive", () => {
			mockState.runInteractiveImports += 1;
			return {
				runInteractive: vi.fn(),
			};
		});
		vi.mock("./utils/session", () => ({
			deleteSession: vi.fn(),
			listSessions: vi.fn(async () => []),
			updateSession: vi.fn(),
		}));

		const exitSignal = new Error("process.exit");
		vi.spyOn(process, "exit").mockImplementation(((code?: string | number) => {
			(exitSignal as Error & { code?: string | number }).code = code;
			throw exitSignal;
		}) as never);

		process.argv = ["bun", "src/index.ts", "sessions", "list"];

		const { runCli } = await import("./main");

		await expect(runCli()).rejects.toMatchObject({
			message: "process.exit",
			code: 0,
		});
		expect(mockState.runAgentImports).toBe(0);
		expect(mockState.runInteractiveImports).toBe(0);
	});

	it("does not load interactive runtime for single-prompt mode", async () => {
		mockState.runAgentImports = 0;
		mockState.runInteractiveImports = 0;
		mockState.runAgentCalls = 0;

		vi.mock("@clinebot/core/server", () => ({
			createTeamName: vi.fn(() => "team-test"),
			createUserInstructionConfigWatcher: vi.fn(() => ({
				start: vi.fn(async () => {}),
				stop: vi.fn(() => {}),
			})),
			loadRulesForSystemPromptFromWatcher: vi.fn(() => []),
			migrateLegacyProviderSettings: vi.fn(() => {}),
			ProviderSettingsManager: class {
				getLastUsedProviderSettings() {
					return undefined;
				}
				getProviderSettings() {
					return undefined;
				}
				saveProviderSettings() {}
			},
		}));
		vi.mock("./commands/auth", () => ({
			ensureOAuthProviderApiKey: vi.fn(),
			getPersistedProviderApiKey: vi.fn(() => undefined),
			isOAuthProvider: vi.fn(() => false),
			normalizeProviderId: vi.fn(
				(providerId?: string) => providerId ?? "cline",
			),
			parseAuthCommandArgs: vi.fn(),
			runAuthCommand: vi.fn(),
		}));
		vi.mock("@clinebot/llms", () => ({
			providers: {
				resolveProviderConfig: vi.fn(async () => undefined),
			},
		}));
		vi.mock("./runtime/prompt", () => ({
			resolveSystemPrompt: vi.fn(async () => "system prompt"),
		}));
		vi.mock("./runtime/run-agent", () => {
			mockState.runAgentImports += 1;
			return {
				runAgent: vi.fn(async () => {
					mockState.runAgentCalls += 1;
				}),
			};
		});
		vi.mock("./runtime/run-interactive", () => {
			mockState.runInteractiveImports += 1;
			return {
				runInteractive: vi.fn(),
			};
		});
		vi.mock("./logging/adapter", () => ({
			createCliLoggerAdapter: vi.fn(() => ({
				core: undefined,
				runtimeConfig: undefined,
			})),
			flushCliLoggerAdapters: vi.fn(),
		}));

		Object.defineProperty(process.stdin, "isTTY", {
			value: true,
			configurable: true,
		});
		process.argv = ["bun", "src/index.ts", "hello"];

		const { runCli } = await import("./main");

		await expect(runCli()).resolves.toBeUndefined();
		expect(mockState.runAgentCalls).toBe(1);
		expect(mockState.runAgentImports).toBe(1);
		expect(mockState.runInteractiveImports).toBe(0);
	});
});
