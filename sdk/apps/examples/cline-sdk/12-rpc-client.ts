/**
 * 12-rpc-client.ts
 *
 * Learn how to use RPC for remote agent sessions.
 *
 * This example shows how to:
 * - Connect to an RPC server
 * - Run remote agent sessions
 * - Stream events from remote agents
 * - Deploy agents in client/server architecture
 * - Scale with distributed runtimes
 *
 * RPC mode enables:
 * - Separation of UI/client from agent runtime
 * - Running agents on dedicated servers
 * - Multiple clients connecting to same runtime
 * - Centralized session management
 * - Scalable deployments
 *
 * Prerequisites:
 * - Set ANTHROPIC_API_KEY environment variable
 * - Start RPC server: clite rpc start
 *
 * Run: bun run 12-rpc-client.ts
 */

async function createRpcSessionClient(address: string): Promise<any> {
	const moduleName = "@cline/rpc";
	const rpc = (await import(moduleName)) as {
		RpcSessionClient: new (options: { address: string }) => any;
	};
	return new rpc.RpcSessionClient({ address });
}

async function demoBasicRpcSession() {
	console.log("\n=== Basic RPC Session ===\n");

	// Connect to RPC server (default: localhost:4317)
	const rpcAddress = process.env.CLINE_RPC_ADDRESS || "127.0.0.1:4317";
	const client = await createRpcSessionClient(rpcAddress);

	try {
		// Check if server is available
		const health = await client.health();
		console.log("RPC Server Status:", health.status);
		console.log(`Version: ${health.version}\n`);

		// Start a remote session
		const startRequest = JSON.stringify({
			config: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-6",
				apiKey: process.env.ANTHROPIC_API_KEY!,
				cwd: process.cwd(),
				systemPrompt: "You are a helpful coding assistant.",
				enableTools: true,
			},
			prompt: "Hello! Tell me about the Cline SDK.",
			interactive: false,
		});

		console.log("Starting remote session...");
		const startResponse = await client.startRuntimeSession(startRequest);
		console.log(`Session ID: ${startResponse.sessionId}\n`);

		// Stream events from the session
		const stopStreaming = client.streamEvents(
			{
				clientId: `example-${Date.now()}`,
				sessionIds: [startResponse.sessionId],
			},
			{
				onEvent: (event: any) => {
					if (event.type === "chunk" && event.payload?.content) {
						// Stream text chunks
						process.stdout.write(event.payload.content);
					} else if (event.type === "agent_event") {
						const agentEvent = event.payload?.event;
						if (agentEvent?.type === "tool_call_start") {
							console.log(`\n🔧 Tool: ${agentEvent.name}`);
						}
					}
				},
				onError: (error: unknown) => {
					console.error("Stream error:", error);
				},
				onComplete: () => {
					console.log("\n\n✅ Session completed");
				},
			},
		);

		// Wait for completion (in real app, this would be event-driven)
		await new Promise((resolve) => setTimeout(resolve, 30000));

		stopStreaming();
	} catch (error) {
		if (error instanceof Error && error.message.includes("ECONNREFUSED")) {
			console.error("❌ Cannot connect to RPC server");
			console.error("Start the server with: clite rpc start");
		} else {
			console.error("Error:", error);
		}
	} finally {
		client.close();
	}
}

async function demoRpcSessionList() {
	console.log("\n=== List Remote Sessions ===\n");

	const rpcAddress = process.env.CLINE_RPC_ADDRESS || "127.0.0.1:4317";
	const client = await createRpcSessionClient(rpcAddress);

	try {
		// List sessions on the server
		const sessions = await client.listSessions({ limit: 10 });

		console.log(`Found ${sessions.length} session(s):\n`);

		for (const session of sessions) {
			console.log(`Session ${session.id}:`);
			console.log(`  Status: ${session.status}`);
			console.log(`  Provider: ${session.provider}`);
			console.log(`  Model: ${session.model}`);
			console.log(`  Started: ${session.started_at}`);
			console.log();
		}
	} catch (error) {
		console.error("Error listing sessions:", error);
	} finally {
		client.close();
	}
}

async function demoRpcWithApprovals() {
	console.log("\n=== RPC Session with Tool Approvals ===\n");

	const rpcAddress = process.env.CLINE_RPC_ADDRESS || "127.0.0.1:4317";
	const client = await createRpcSessionClient(rpcAddress);

	try {
		// Start session that requires tool approvals
		const startRequest = JSON.stringify({
			config: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-6",
				apiKey: process.env.ANTHROPIC_API_KEY!,
				cwd: process.cwd(),
				systemPrompt: "You are a helpful assistant.",
				enableTools: true,
			},
			toolPolicies: {
				run_commands: "require_approval",
				editor: "require_approval",
			},
			prompt: "Create a test file called rpc-demo.txt with content 'Hello RPC'",
			interactive: false,
		});

		const startResponse = await client.startRuntimeSession(startRequest);
		console.log(`Session ID: ${startResponse.sessionId}`);

		// Handle approval requests
		const stopStreaming = client.streamEvents(
			{
				clientId: `example-approval-${Date.now()}`,
				sessionIds: [startResponse.sessionId],
			},
			{
				onEvent: async (event: any) => {
					if (event.type === "approval_request") {
						const request = event.payload;
						console.log(`\n🔔 Approval Request:`);
						console.log(`  Tool: ${request.tool.name}`);
						console.log(`  Input: ${JSON.stringify(request.input, null, 2)}`);

						// Auto-approve for demo
						console.log("  ✅ Auto-approved\n");

						await client.respondToApproval({
							sessionId: startResponse.sessionId,
							approvalId: request.id,
							approved: true,
							feedback: "Approved automatically for demo",
						});
					} else if (event.type === "chunk" && event.payload?.content) {
						process.stdout.write(event.payload.content);
					}
				},
				onError: (error: unknown) => {
					console.error("Stream error:", error);
				},
				onComplete: () => {
					console.log("\n\n✅ Session completed with approvals");
				},
			},
		);

		await new Promise((resolve) => setTimeout(resolve, 30000));
		stopStreaming();
	} catch (error) {
		console.error("Error:", error);
	} finally {
		client.close();
	}
}

async function demoMultiClientRpc() {
	console.log("\n=== Multiple Clients on One Server ===\n");

	const rpcAddress = process.env.CLINE_RPC_ADDRESS || "127.0.0.1:4317";

	// Simulate multiple clients
	const client1 = await createRpcSessionClient(rpcAddress);
	const client2 = await createRpcSessionClient(rpcAddress);

	try {
		// Client 1 starts a session
		console.log("Client 1: Starting session...");
		const response1 = await client1.startRuntimeSession(
			JSON.stringify({
				config: {
					providerId: "anthropic",
					modelId: "claude-sonnet-4-6",
					apiKey: process.env.ANTHROPIC_API_KEY!,
					cwd: process.cwd(),
					systemPrompt: "You are assistant #1",
				},
				prompt: "Count from 1 to 5",
				interactive: false,
			}),
		);
		console.log(`Client 1 Session: ${response1.sessionId}`);

		// Client 2 starts a session
		console.log("\nClient 2: Starting session...");
		const response2 = await client2.startRuntimeSession(
			JSON.stringify({
				config: {
					providerId: "anthropic",
					modelId: "claude-sonnet-4-6",
					apiKey: process.env.ANTHROPIC_API_KEY!,
					cwd: process.cwd(),
					systemPrompt: "You are assistant #2",
				},
				prompt: "List 3 programming languages",
				interactive: false,
			}),
		);
		console.log(`Client 2 Session: ${response2.sessionId}`);

		console.log("\n✅ Multiple clients can share the same RPC server");
	} catch (error) {
		console.error("Error:", error);
	} finally {
		client1.close();
		client2.close();
	}
}

async function demoRpcSessionContinuation() {
	console.log("\n=== RPC Session Continuation ===\n");

	const rpcAddress = process.env.CLINE_RPC_ADDRESS || "127.0.0.1:4317";
	const client = await createRpcSessionClient(rpcAddress);

	try {
		// Start interactive session
		const startRequest = JSON.stringify({
			config: {
				providerId: "anthropic",
				modelId: "claude-sonnet-4-6",
				apiKey: process.env.ANTHROPIC_API_KEY!,
				cwd: process.cwd(),
				systemPrompt:
					"You are a helpful assistant. Remember context from previous messages.",
			},
			prompt: "My favorite language is TypeScript. Remember this.",
			interactive: true,
		});

		const startResponse = await client.startRuntimeSession(startRequest);
		const sessionId = startResponse.sessionId;
		console.log(`Session started: ${sessionId}\n`);

		await new Promise((resolve) => setTimeout(resolve, 15000));

		// Continue the session
		console.log("\nContinuing session...");
		const sendRequest = JSON.stringify({
			sessionId,
			prompt: "What's my favorite language?",
		});

		await client.sendToSession(sendRequest);

		// Stream the continuation
		client.streamEvents(
			{
				clientId: `example-continue-${Date.now()}`,
				sessionIds: [sessionId],
			},
			{
				onEvent: (event: any) => {
					if (event.type === "chunk" && event.payload?.content) {
						process.stdout.write(event.payload.content);
					}
				},
				onComplete: () => {
					console.log("\n\n✅ Session continued successfully");
				},
			},
		);

		await new Promise((resolve) => setTimeout(resolve, 15000));
	} catch (error) {
		console.error("Error:", error);
	} finally {
		client.close();
	}
}

async function main() {
	if (!process.env.ANTHROPIC_API_KEY) {
		console.error("Please set ANTHROPIC_API_KEY environment variable");
		process.exit(1);
	}

	console.log("🚀 Starting RPC Client Examples");
	console.log("Make sure RPC server is running: clite rpc start");
	console.log("Default address: 127.0.0.1:4317\n");

	await demoBasicRpcSession();
	await demoRpcSessionList();
	await demoRpcWithApprovals();
	await demoMultiClientRpc();
	await demoRpcSessionContinuation();

	console.log("\n✅ All RPC demos completed!");
	console.log("\n💡 Benefits of RPC mode:");
	console.log("   • Separate client UI from agent runtime");
	console.log("   • Run agents on dedicated servers");
	console.log("   • Multiple clients can connect to one server");
	console.log("   • Centralized session management");
	console.log("   • Better for production deployments");
	console.log("   • Enable distributed agent systems");
	console.log("\n📚 Learn more:");
	console.log("   • RPC server: clite rpc start --help");
	console.log("   • Package: @cline/rpc");
	console.log("   • Desktop app (apps/desktop) uses RPC architecture");
}

main().catch(console.error);
