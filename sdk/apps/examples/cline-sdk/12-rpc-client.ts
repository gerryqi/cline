/**
 * 12-rpc-client.ts
 *
 * Learn how to use RPC for remote agent sessions.
 *
 * This example shows how to:
 * - Connect to an RPC server
 * - Run remote agent sessions
 * - Stream runtime events
 * - Handle tool approval events
 * - Continue sessions across turns
 *
 * Prerequisites:
 * - Set ANTHROPIC_API_KEY environment variable
 * - Start RPC server: clite rpc start
 *
 * Run: bun run 12-rpc-client.ts
 */

import process from "node:process";
import type { RpcChatStartSessionRequest } from "@clinebot/core";
import { getRpcServerHealth, RpcSessionClient } from "@clinebot/core/server";

function createRpcSessionClient(address: string): RpcSessionClient {
	return new RpcSessionClient({ address });
}

function requireAnthropicApiKey(): string {
	const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
	if (!apiKey) {
		throw new Error("Please set ANTHROPIC_API_KEY environment variable");
	}
	return apiKey;
}

function createStartRequest(input: {
	apiKey: string;
	systemPrompt: string;
	enableTools?: boolean;
	toolPolicies?: RpcChatStartSessionRequest["toolPolicies"];
}): RpcChatStartSessionRequest {
	return {
		workspaceRoot: process.cwd(),
		cwd: process.cwd(),
		provider: "anthropic",
		model: "claude-sonnet-4-6",
		mode: "act",
		apiKey: input.apiKey,
		systemPrompt: input.systemPrompt,
		enableTools: input.enableTools === true,
		enableSpawn: false,
		enableTeams: false,
		autoApproveTools: false,
		teamName: "rpc-example",
		missionStepInterval: 3,
		missionTimeIntervalMs: 120000,
		toolPolicies: input.toolPolicies,
	};
}

function resolveTextDelta(
	payload: Record<string, unknown>,
	streamedText: string,
): { delta: string; nextText: string } {
	const accumulated =
		typeof payload.accumulated === "string" ? payload.accumulated : undefined;
	if (typeof accumulated === "string") {
		if (accumulated.startsWith(streamedText)) {
			return {
				delta: accumulated.slice(streamedText.length),
				nextText: accumulated,
			};
		}
		if (streamedText.startsWith(accumulated)) {
			return {
				delta: "",
				nextText: streamedText,
			};
		}
	}

	const text = typeof payload.text === "string" ? payload.text : "";
	return {
		delta: text,
		nextText: `${streamedText}${text}`,
	};
}

async function cleanupSession(
	client: RpcSessionClient,
	sessionId: string,
): Promise<void> {
	if (!sessionId.trim()) {
		return;
	}
	try {
		await client.stopRuntimeSession(sessionId);
	} catch {
		// Best effort cleanup.
	}
	try {
		await client.deleteSession(sessionId, true);
	} catch {
		// Best effort cleanup.
	}
}

async function demoBasicRpcSession(
	rpcAddress: string,
	apiKey: string,
): Promise<void> {
	console.log("\n=== Basic RPC Session ===\n");
	const client = createRpcSessionClient(rpcAddress);
	let sessionId = "";

	try {
		const startRequest = createStartRequest({
			apiKey,
			systemPrompt: "You are a helpful coding assistant.",
			enableTools: true,
		});

		console.log("Starting remote session...");
		const started = await client.startRuntimeSession(startRequest);
		sessionId = started.sessionId.trim();
		console.log(`Session ID: ${sessionId}`);
		if (started.startResult?.manifestPath) {
			console.log(`Manifest path: ${started.startResult.manifestPath}`);
		}
		console.log();

		let streamedText = "";
		const stopStreaming = client.streamEvents(
			{
				clientId: `example-basic-${Date.now()}`,
				sessionIds: [sessionId],
			},
			{
				onEvent: (event) => {
					if (event.eventType === "runtime.chat.text_delta") {
						const resolved = resolveTextDelta(event.payload, streamedText);
						if (resolved.delta) {
							process.stdout.write(resolved.delta);
						}
						streamedText = resolved.nextText;
					}
				},
				onError: (error) => {
					console.error("Stream error:", error.message);
				},
			},
		);

		const sent = await client.sendRuntimeSession(sessionId, {
			config: startRequest,
			prompt: "Hello! Tell me about the Cline SDK.",
		});
		stopStreaming();

		if (sent.result.text && !sent.result.text.startsWith(streamedText)) {
			process.stdout.write(`\n${sent.result.text}`);
		}
		console.log("\n\n✅ Session completed");
		console.log(`Finish reason: ${sent.result.finishReason}`);
	} finally {
		await cleanupSession(client, sessionId);
		client.close();
	}
}

async function demoRpcSessionList(rpcAddress: string): Promise<void> {
	console.log("\n=== List Remote Sessions ===\n");

	const client = createRpcSessionClient(rpcAddress);
	try {
		const sessions = await client.listSessions({ limit: 10 });
		console.log(`Found ${sessions.length} session(s):\n`);
		for (const session of sessions) {
			console.log(`Session ${session.sessionId}:`);
			console.log(`  Status: ${session.status}`);
			console.log(`  Provider: ${session.provider}`);
			console.log(`  Model: ${session.model}`);
			console.log(`  Started: ${session.startedAt}`);
			console.log();
		}
	} finally {
		client.close();
	}
}

async function demoRpcWithApprovals(
	rpcAddress: string,
	apiKey: string,
): Promise<void> {
	console.log("\n=== RPC Session with Tool Approvals ===\n");

	const client = createRpcSessionClient(rpcAddress);
	let sessionId = "";

	try {
		const startRequest = createStartRequest({
			apiKey,
			systemPrompt: "You are a helpful assistant.",
			enableTools: true,
			toolPolicies: {
				run_commands: { enabled: true, autoApprove: false },
			},
		});

		const started = await client.startRuntimeSession(startRequest);
		sessionId = started.sessionId.trim();
		console.log(`Session ID: ${sessionId}`);

		let streamedText = "";
		const stopStreaming = client.streamEvents(
			{
				clientId: `example-approval-${Date.now()}`,
				sessionIds: [sessionId],
			},
			{
				onEvent: async (event) => {
					if (event.eventType === "approval.requested") {
						const approvalId =
							typeof event.payload.approvalId === "string"
								? event.payload.approvalId
								: "";
						const toolName =
							typeof event.payload.toolName === "string"
								? event.payload.toolName
								: "unknown";
						console.log(`\n🔔 Approval request for tool: ${toolName}`);
						if (approvalId) {
							await client.respondToolApproval({
								approvalId,
								approved: true,
								reason: "Approved automatically for demo",
								responderClientId: `example-approval-${process.pid}`,
							});
							console.log("  ✅ Auto-approved");
						}
						return;
					}

					if (event.eventType === "runtime.chat.text_delta") {
						const resolved = resolveTextDelta(event.payload, streamedText);
						if (resolved.delta) {
							process.stdout.write(resolved.delta);
						}
						streamedText = resolved.nextText;
					}
				},
				onError: (error) => {
					console.error("Stream error:", error.message);
				},
			},
		);

		const sent = await client.sendRuntimeSession(sessionId, {
			config: startRequest,
			prompt: "Run `pwd` and explain the output in one sentence.",
		});
		stopStreaming();

		if (sent.result.text && !sent.result.text.startsWith(streamedText)) {
			process.stdout.write(`\n${sent.result.text}`);
		}
		console.log("\n\n✅ Session completed with approvals");
	} finally {
		await cleanupSession(client, sessionId);
		client.close();
	}
}

async function demoMultiClientRpc(
	rpcAddress: string,
	apiKey: string,
): Promise<void> {
	console.log("\n=== Multiple Clients on One Server ===\n");

	const client1 = createRpcSessionClient(rpcAddress);
	const client2 = createRpcSessionClient(rpcAddress);
	let session1 = "";
	let session2 = "";

	try {
		const startRequest1 = createStartRequest({
			apiKey,
			systemPrompt: "You are assistant #1",
		});
		const startRequest2 = createStartRequest({
			apiKey,
			systemPrompt: "You are assistant #2",
		});

		console.log("Client 1: Starting session...");
		const started1 = await client1.startRuntimeSession(startRequest1);
		session1 = started1.sessionId.trim();
		console.log(`Client 1 Session: ${session1}`);

		console.log("Client 2: Starting session...");
		const started2 = await client2.startRuntimeSession(startRequest2);
		session2 = started2.sessionId.trim();
		console.log(`Client 2 Session: ${session2}`);

		const [result1, result2] = await Promise.all([
			client1.sendRuntimeSession(session1, {
				config: startRequest1,
				prompt: "Count from 1 to 5.",
			}),
			client2.sendRuntimeSession(session2, {
				config: startRequest2,
				prompt: "List 3 programming languages.",
			}),
		]);

		console.log(`\nClient 1 reply: ${result1.result.text.slice(0, 120)}...`);
		console.log(`Client 2 reply: ${result2.result.text.slice(0, 120)}...`);
		console.log("\n✅ Multiple clients can share the same RPC server");
	} finally {
		await Promise.all([
			cleanupSession(client1, session1),
			cleanupSession(client2, session2),
		]);
		client1.close();
		client2.close();
	}
}

async function demoRpcSessionContinuation(
	rpcAddress: string,
	apiKey: string,
): Promise<void> {
	console.log("\n=== RPC Session Continuation ===\n");

	const client = createRpcSessionClient(rpcAddress);
	let sessionId = "";
	try {
		const startRequest = createStartRequest({
			apiKey,
			systemPrompt:
				"You are a helpful assistant. Remember context from previous messages.",
		});

		const started = await client.startRuntimeSession(startRequest);
		sessionId = started.sessionId.trim();
		console.log(`Session started: ${sessionId}\n`);

		await client.sendRuntimeSession(sessionId, {
			config: startRequest,
			prompt: "My favorite language is TypeScript. Remember this.",
		});

		console.log("Continuing session...");
		const continued = await client.sendRuntimeSession(sessionId, {
			config: startRequest,
			prompt: "What's my favorite language?",
		});
		console.log(`Assistant: ${continued.result.text}`);
		console.log("\n✅ Session continued successfully");
	} finally {
		await cleanupSession(client, sessionId);
		client.close();
	}
}

async function main() {
	const apiKey = requireAnthropicApiKey();
	const rpcAddress = process.env.CLINE_RPC_ADDRESS || "127.0.0.1:4317";
	const health = await getRpcServerHealth(rpcAddress);
	if (!health?.running) {
		throw new Error(
			`RPC server is not reachable at ${rpcAddress}. Start it with: clite rpc start --address ${rpcAddress}`,
		);
	}

	console.log("🚀 Starting RPC Client Examples");
	console.log(`RPC server: ${rpcAddress}`);
	console.log(`Server ID: ${health.serverId}`);
	console.log();

	await demoBasicRpcSession(rpcAddress, apiKey);
	await demoRpcSessionList(rpcAddress);
	await demoRpcWithApprovals(rpcAddress, apiKey);
	await demoMultiClientRpc(rpcAddress, apiKey);
	await demoRpcSessionContinuation(rpcAddress, apiKey);

	console.log("\n✅ All RPC demos completed!");
	console.log("\n💡 Benefits of RPC mode:");
	console.log("   • Separate client UI from agent runtime");
	console.log("   • Run agents on dedicated servers");
	console.log("   • Multiple clients can connect to one server");
	console.log("   • Centralized session management");
	console.log("   • Better for production deployments");
	console.log("   • Enable distributed agent systems");
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
