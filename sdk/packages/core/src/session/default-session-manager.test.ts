import type { AgentResult } from "@cline/agents";
import { describe, expect, it, vi } from "vitest";
import { SessionSource } from "../types/common";
import type { CoreSessionConfig } from "../types/config";
import { DefaultSessionManager } from "./default-session-manager";
import type { SessionManifest } from "./session-manifest";

function createResult(overrides: Partial<AgentResult> = {}): AgentResult {
	return {
		text: "ok",
		iterations: 1,
		finishReason: "completed",
		usage: {
			inputTokens: 1,
			outputTokens: 2,
			totalCost: 0,
		},
		messages: [],
		toolCalls: [],
		durationMs: 1,
		model: {
			id: "mock-model",
			provider: "mock-provider",
		},
		startedAt: new Date("2026-01-01T00:00:00.000Z"),
		endedAt: new Date("2026-01-01T00:00:01.000Z"),
		...overrides,
	};
}

function createManifest(sessionId: string): SessionManifest {
	return {
		version: 1,
		session_id: sessionId,
		source: SessionSource.CLI,
		pid: process.pid,
		started_at: "2026-01-01T00:00:00.000Z",
		status: "running",
		interactive: false,
		provider: "mock-provider",
		model: "mock-model",
		cwd: "/tmp/project",
		workspace_root: "/tmp/project",
		enable_tools: true,
		enable_spawn: true,
		enable_teams: true,
		prompt: "hello",
		messages_path: "/tmp/messages.json",
	};
}

function createConfig(
	overrides: Partial<CoreSessionConfig> = {},
): CoreSessionConfig {
	return {
		providerId: "mock-provider",
		modelId: "mock-model",
		cwd: "/tmp/project",
		systemPrompt: "You are a test agent",
		enableTools: true,
		enableSpawnAgent: true,
		enableAgentTeams: true,
		...overrides,
	};
}

describe("DefaultSessionManager", () => {
	it("runs a non-interactive prompt and persists messages/status", async () => {
		const sessionId = "sess-1";
		const manifest = createManifest(sessionId);
		const createRootSessionWithArtifacts = vi.fn().mockResolvedValue({
			manifestPath: "/tmp/manifest.json",
			transcriptPath: "/tmp/transcript.log",
			hookPath: "/tmp/hook.log",
			messagesPath: "/tmp/messages.json",
			manifest,
		});
		const persistSessionMessages = vi.fn();
		const updateSessionStatus = vi.fn().mockResolvedValue({
			updated: true,
			endedAt: "2026-01-01T00:00:05.000Z",
		});
		const writeSessionManifest = vi.fn();
		const listSessions = vi.fn().mockResolvedValue([]);
		const deleteSession = vi.fn().mockResolvedValue({ deleted: true });
		const sessionService = {
			createRootSessionWithArtifacts,
			persistSessionMessages,
			updateSessionStatus,
			writeSessionManifest,
			listSessions,
			deleteSession,
		};

		const shutdown = vi.fn();
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({
				tools: [],
				shutdown,
			}),
		};
		const run = vi.fn().mockResolvedValue(
			createResult({
				messages: [
					{ role: "user", content: [{ type: "text", text: "hello" }] },
				],
			}),
		);
		const continueFn = vi.fn();
		const agent = {
			run,
			continue: continueFn,
			abort: vi.fn(),
			shutdown: vi.fn().mockResolvedValue(undefined),
			getMessages: vi.fn().mockReturnValue([]),
			messages: [],
		};

		const manager = new DefaultSessionManager({
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: () => agent as never,
		});

		const started = await manager.start({
			config: createConfig(),
			prompt: "hello",
			interactive: false,
		});

		expect(started.sessionId).toBe(sessionId);
		expect(started.result?.finishReason).toBe("completed");
		expect(run).toHaveBeenCalledTimes(1);
		expect(continueFn).not.toHaveBeenCalled();
		expect(persistSessionMessages).toHaveBeenCalledTimes(1);
		expect(updateSessionStatus).toHaveBeenCalledWith(sessionId, "completed", 0);
		expect(writeSessionManifest).toHaveBeenCalledTimes(1);
		expect(shutdown).toHaveBeenCalledTimes(1);
	});

	it("uses run for first send then continue for subsequent sends", async () => {
		const sessionId = "sess-2";
		const manifest = createManifest(sessionId);
		const sessionService = {
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest-2.json",
				transcriptPath: "/tmp/transcript-2.log",
				hookPath: "/tmp/hook-2.log",
				messagesPath: "/tmp/messages-2.json",
				manifest,
			}),
			persistSessionMessages: vi.fn(),
			updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({
				tools: [],
				shutdown: vi.fn(),
			}),
		};
		const run = vi.fn().mockResolvedValue(createResult({ text: "first" }));
		const continueFn = vi
			.fn()
			.mockResolvedValue(createResult({ text: "second" }));
		const manager = new DefaultSessionManager({
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: () =>
				({
					run,
					continue: continueFn,
					abort: vi.fn(),
					shutdown: vi.fn().mockResolvedValue(undefined),
					getMessages: vi.fn().mockReturnValue([]),
					messages: [],
				}) as never,
		});

		await manager.start({
			config: createConfig(),
			interactive: true,
		});
		const first = await manager.send({ sessionId, prompt: "first" });
		const second = await manager.send({ sessionId, prompt: "second" });

		expect(first?.text).toBe("first");
		expect(second?.text).toBe("second");
		expect(run).toHaveBeenCalledTimes(1);
		expect(continueFn).toHaveBeenCalledTimes(1);
		expect(sessionService.persistSessionMessages).toHaveBeenCalledTimes(2);
	});

	it("marks a failed single-run session as failed when run throws", async () => {
		const sessionId = "sess-fail";
		const manifest = createManifest(sessionId);
		const sessionService = {
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest-fail.json",
				transcriptPath: "/tmp/transcript-fail.log",
				hookPath: "/tmp/hook-fail.log",
				messagesPath: "/tmp/messages-fail.json",
				manifest,
			}),
			persistSessionMessages: vi.fn(),
			updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const runtimeShutdown = vi.fn();
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({
				tools: [],
				shutdown: runtimeShutdown,
			}),
		};
		const run = vi.fn().mockRejectedValue(new Error("run failed"));
		const agentShutdown = vi.fn().mockResolvedValue(undefined);
		const manager = new DefaultSessionManager({
			sessionService: sessionService as never,
			runtimeBuilder,
			createAgent: () =>
				({
					run,
					continue: vi.fn(),
					abort: vi.fn(),
					shutdown: agentShutdown,
					getMessages: vi.fn().mockReturnValue([]),
					messages: [],
				}) as never,
		});

		await expect(
			manager.start({
				config: createConfig(),
				prompt: "hello",
				interactive: false,
			}),
		).rejects.toThrow("run failed");
		expect(sessionService.updateSessionStatus).toHaveBeenCalledWith(
			sessionId,
			"failed",
			1,
		);
		expect(agentShutdown).toHaveBeenCalledTimes(1);
		expect(runtimeShutdown).toHaveBeenCalledTimes(1);
	});

	it("updates agent connection with refreshed OAuth key before turn", async () => {
		const sessionId = "sess-oauth";
		const manifest = createManifest(sessionId);
		const sessionService = {
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest-oauth.json",
				transcriptPath: "/tmp/transcript-oauth.log",
				hookPath: "/tmp/hook-oauth.log",
				messagesPath: "/tmp/messages-oauth.json",
				manifest,
			}),
			persistSessionMessages: vi.fn(),
			updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({
				tools: [],
				shutdown: vi.fn(),
			}),
		};
		const run = vi.fn().mockResolvedValue(createResult({ text: "ok" }));
		const updateConnection = vi.fn();
		const manager = new DefaultSessionManager({
			sessionService: sessionService as never,
			runtimeBuilder,
			oauthTokenManager: {
				resolveProviderApiKey: vi.fn().mockResolvedValue({
					providerId: "openai-codex",
					apiKey: "oauth-access-new",
					refreshed: true,
				}),
			} as never,
			createAgent: () =>
				({
					run,
					continue: vi.fn(),
					abort: vi.fn(),
					restore: vi.fn(),
					updateConnection,
					shutdown: vi.fn().mockResolvedValue(undefined),
					getMessages: vi.fn().mockReturnValue([]),
					messages: [],
				}) as never,
		});

		await manager.start({
			config: createConfig({
				providerId: "openai-codex",
				apiKey: "oauth-access-old",
			}),
			interactive: true,
		});
		await manager.send({ sessionId, prompt: "hello" });

		expect(updateConnection).toHaveBeenCalledWith({
			apiKey: "oauth-access-new",
		});
		expect(run).toHaveBeenCalledTimes(1);
	});

	it("force refreshes and retries once when turn fails with auth error", async () => {
		const sessionId = "sess-oauth-retry";
		const manifest = createManifest(sessionId);
		const sessionService = {
			createRootSessionWithArtifacts: vi.fn().mockResolvedValue({
				manifestPath: "/tmp/manifest-oauth-retry.json",
				transcriptPath: "/tmp/transcript-oauth-retry.log",
				hookPath: "/tmp/hook-oauth-retry.log",
				messagesPath: "/tmp/messages-oauth-retry.json",
				manifest,
			}),
			persistSessionMessages: vi.fn(),
			updateSessionStatus: vi.fn().mockResolvedValue({ updated: true }),
			writeSessionManifest: vi.fn(),
			listSessions: vi.fn().mockResolvedValue([]),
			deleteSession: vi.fn().mockResolvedValue({ deleted: true }),
		};
		const runtimeBuilder = {
			build: vi.fn().mockReturnValue({
				tools: [],
				shutdown: vi.fn(),
			}),
		};
		const run = vi
			.fn()
			.mockRejectedValueOnce(new Error("401 Unauthorized"))
			.mockResolvedValueOnce(createResult({ text: "retried" }));
		const restore = vi.fn();
		const updateConnection = vi.fn();
		const resolveProviderApiKey = vi
			.fn()
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({
				providerId: "openai-codex",
				apiKey: "oauth-access-new",
				refreshed: true,
			});
		const manager = new DefaultSessionManager({
			sessionService: sessionService as never,
			runtimeBuilder,
			oauthTokenManager: {
				resolveProviderApiKey,
			} as never,
			createAgent: () =>
				({
					run,
					continue: vi.fn(),
					abort: vi.fn(),
					restore,
					updateConnection,
					shutdown: vi.fn().mockResolvedValue(undefined),
					getMessages: vi.fn().mockReturnValue([]),
					messages: [],
				}) as never,
		});

		await manager.start({
			config: createConfig({
				providerId: "openai-codex",
				apiKey: "oauth-access-old",
			}),
			interactive: true,
		});
		const result = await manager.send({ sessionId, prompt: "hello" });

		expect(result?.text).toBe("retried");
		expect(run).toHaveBeenCalledTimes(2);
		expect(restore).toHaveBeenCalledTimes(1);
		expect(resolveProviderApiKey).toHaveBeenNthCalledWith(1, {
			providerId: "openai-codex",
			forceRefresh: undefined,
		});
		expect(resolveProviderApiKey).toHaveBeenNthCalledWith(2, {
			providerId: "openai-codex",
			forceRefresh: true,
		});
		expect(updateConnection).toHaveBeenCalledWith({
			apiKey: "oauth-access-new",
		});
	});
});
