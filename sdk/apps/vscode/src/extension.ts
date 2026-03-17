import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { getRpcServerHealth, RpcSessionClient } from "@cline/rpc";
import type {
	RpcChatRunTurnRequest,
	RpcChatStartSessionRequest,
	RpcChatTurnResult,
	RpcProviderCatalogResponse,
	RpcProviderModel,
} from "@cline/shared";
import * as vscode from "vscode";
import type {
	WebviewInboundMessage,
	WebviewOutboundMessage,
} from "./webview-protocol";

const execFileAsync = promisify(execFile);
const DEFAULT_RPC_ADDRESS = "127.0.0.1:4317";

export function activate(context: vscode.ExtensionContext): void {
	const openChat = vscode.commands.registerCommand(
		"clineVscode.openChat",
		() => {
			const localResourceRoots = [
				vscode.Uri.joinPath(context.extensionUri, "dist", "webview"),
			];
			const panel = vscode.window.createWebviewPanel(
				"clineChat",
				"Cline Chat",
				vscode.ViewColumn.One,
				{
					enableScripts: true,
					retainContextWhenHidden: true,
					localResourceRoots,
				},
			);
			const controller = new RpcChatWebviewController(
				panel,
				context.extensionUri,
			);
			context.subscriptions.push(controller);
		},
	);
	context.subscriptions.push(openChat);
}

export function deactivate(): void {
	// no-op; webview controllers are disposed by VS Code subscriptions
}

class RpcChatWebviewController implements vscode.Disposable {
	private readonly panel: vscode.WebviewPanel;
	private readonly extensionUri: vscode.Uri;
	private readonly disposables: vscode.Disposable[] = [];
	private client: RpcSessionClient | undefined;
	private rpcAddress = "";
	private sessionId: string | undefined;
	private startConfig: RpcChatStartSessionRequest | undefined;
	private stopStreaming: (() => void) | undefined;
	private readonly streamClientId =
		`vscode-${Date.now()}-${Math.random().toString(16).slice(2)}`;
	private sending = false;
	private streamedAssistantText = "";

	constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
		this.panel = panel;
		this.extensionUri = extensionUri;
		this.disposables.push(
			this.panel.webview.onDidReceiveMessage(
				(message: WebviewInboundMessage) => {
					void this.handleMessage(message);
				},
			),
			this.panel.onDidDispose(() => {
				this.dispose();
			}),
		);
		void this.initializeWebview();
	}

	public dispose(): void {
		this.stopEventStream();
		if (this.sessionId && this.client) {
			void this.client.stopRuntimeSession(this.sessionId).catch(() => {
				// best-effort cleanup
			});
		}
		this.client?.close();
		this.client = undefined;
		this.sessionId = undefined;
		this.startConfig = undefined;
		while (this.disposables.length > 0) {
			const disposable = this.disposables.pop();
			disposable?.dispose();
		}
	}

	private async handleMessage(message: WebviewInboundMessage): Promise<void> {
		if (message.type === "ready") {
			await this.initialize();
			return;
		}
		if (message.type === "loadModels") {
			await this.loadModels(message.providerId);
			return;
		}
		if (message.type === "abort") {
			await this.abortTurn();
			return;
		}
		if (message.type === "reset") {
			await this.resetSession();
			return;
		}
		if (message.type === "send") {
			await this.sendPrompt(message.prompt, message.config);
		}
	}

	private async initialize(): Promise<void> {
		try {
			const ensuredAddress = await this.ensureRpcAddress();
			await this.post({
				type: "status",
				text: ensuredAddress ? "Cline is Ready" : "Failed to connect to Cline",
			});
			const defaults = this.resolveWorkspaceDefaults();
			await this.post({ type: "defaults", defaults });
			await this.loadProviders(defaults.provider);
		} catch (error) {
			await this.postError(error);
		}
	}

	private async initializeWebview(): Promise<void> {
		try {
			this.panel.webview.html = await this.getWebviewHtml();
		} catch (error) {
			await this.postError(error);
		}
	}

	private async getWebviewHtml(): Promise<string> {
		const devServerUrl = process.env.VITE_DEV_SERVER_URL;
		if (devServerUrl) {
			return this.getDevWebviewHtml(devServerUrl);
		}
		return this.getProductionWebviewHtml();
	}

	private getDevWebviewHtml(devServerUrl: string): string {
		const host = new URL(devServerUrl).host;
		const csp = [
			"default-src 'none'",
			`img-src ${this.panel.webview.cspSource} data: ${devServerUrl}`,
			`style-src ${this.panel.webview.cspSource} 'unsafe-inline' ${devServerUrl}`,
			`font-src ${this.panel.webview.cspSource} ${devServerUrl}`,
			`script-src 'unsafe-inline' ${devServerUrl}`,
			`connect-src ${devServerUrl} ws://${host} ws://localhost:${new URL(devServerUrl).port}`,
		].join("; ");

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta http-equiv="Content-Security-Policy" content="${csp}" />
	<script type="module">
		import RefreshRuntime from "${devServerUrl}/@react-refresh";
		RefreshRuntime.injectIntoGlobalHook(window);
		window.$RefreshReg$ = () => {};
		window.$RefreshSig$ = () => (type) => type;
		window.__vite_plugin_react_preamble_installed__ = true;
	</script>
	<script type="module" src="${devServerUrl}/@vite/client"></script>
</head>
<body>
	<div id="root"></div>
	<script type="module" src="${devServerUrl}/src/main.tsx"></script>
</body>
</html>`;
	}

	private async getProductionWebviewHtml(): Promise<string> {
		const webview = this.panel.webview;
		const distDir = vscode.Uri.joinPath(this.extensionUri, "dist", "webview");
		const indexPath = join(distDir.fsPath, "index.html");
		const nonce = createNonce();
		let html = await vscode.workspace.fs
			.readFile(vscode.Uri.file(indexPath))
			.then((buffer) => Buffer.from(buffer).toString("utf8"));

		html = html.replace(
			/<(script|link)([^>]+?(?:src|href))="([^"]+)"([^>]*)>/g,
			(_match, tag, attrPrefix, assetPath, suffix) => {
				if (
					assetPath.startsWith("http://") ||
					assetPath.startsWith("https://") ||
					assetPath.startsWith("data:")
				) {
					return `<${tag}${attrPrefix}="${assetPath}"${suffix}>`;
				}
				const normalizedAssetPath = assetPath.replace(/^\.?\//, "");
				const assetUri = webview.asWebviewUri(
					vscode.Uri.joinPath(distDir, normalizedAssetPath),
				);
				const nonceAttr = tag === "script" ? ` nonce="${nonce}"` : "";
				return `<${tag}${nonceAttr}${attrPrefix}="${assetUri.toString()}"${suffix}>`;
			},
		);

		const csp = [
			"default-src 'none'",
			`img-src ${webview.cspSource} data:`,
			`style-src ${webview.cspSource} 'unsafe-inline'`,
			`font-src ${webview.cspSource}`,
			`script-src 'nonce-${nonce}'`,
		].join("; ");

		if (html.includes("<head>")) {
			html = html.replace(
				"<head>",
				`<head>\n<meta http-equiv="Content-Security-Policy" content="${csp}" />`,
			);
		}

		return html;
	}

	private resolveWorkspaceDefaults(): {
		provider?: string;
		model?: string;
		workspaceRoot: string;
		cwd: string;
	} {
		const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		const cwd = folder ?? process.cwd();
		return {
			workspaceRoot: cwd,
			cwd,
		};
	}

	private async ensureRpcAddress(): Promise<string> {
		if (this.client && this.rpcAddress) {
			return this.rpcAddress;
		}
		const requested =
			process.env.CLINE_RPC_ADDRESS?.trim() || DEFAULT_RPC_ADDRESS;
		let resolved = requested;
		const health = await getRpcServerHealth(requested).catch(() => undefined);
		if (!health?.running) {
			const ensured = await this.runRpcEnsure(requested);
			resolved = ensured.address;
		}
		process.env.CLINE_RPC_ADDRESS = resolved;
		this.rpcAddress = resolved;
		this.client = new RpcSessionClient({ address: resolved });
		return resolved;
	}

	private async runRpcEnsure(
		requestedAddress: string,
	): Promise<{ address: string }> {
		const result = await execFileAsync(
			"clite",
			["rpc", "ensure", "--address", requestedAddress, "--json"],
			{ timeout: 30_000 },
		);
		const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
		const lines = combined
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter((line) => line.length > 0);
		for (let index = lines.length - 1; index >= 0; index -= 1) {
			const line = lines[index];
			try {
				const parsed = JSON.parse(line) as {
					address?: string;
					running?: boolean;
				};
				if (parsed.running === true && parsed.address?.trim()) {
					return { address: parsed.address.trim() };
				}
			} catch {
				// continue scanning
			}
		}
		throw new Error("failed to parse `clite rpc ensure --json` output");
	}

	private async loadProviders(preferredProvider?: string): Promise<void> {
		const client = await this.getClient();
		const response = await client.runProviderAction({
			action: "listProviders",
		});
		const parsed = response.result as RpcProviderCatalogResponse;
		const providers = (parsed.providers ?? []).map((provider) => ({
			id: provider.id,
			name: provider.name,
			enabled: provider.enabled === true,
			defaultModelId: provider.defaultModelId,
		}));
		await this.post({ type: "providers", providers });

		const selected =
			(preferredProvider &&
				providers.find((item) => item.id === preferredProvider)) ||
			providers.find((item) => item.enabled) ||
			providers[0];
		if (selected) {
			await this.loadModels(selected.id);
		}
	}

	private async loadModels(providerId: string): Promise<void> {
		const provider = providerId.trim();
		if (!provider) {
			return;
		}
		const client = await this.getClient();
		const response = await client.runProviderAction({
			action: "getProviderModels",
			providerId: provider,
		});
		const parsed = response.result as {
			models?: RpcProviderModel[];
		};
		await this.post({
			type: "models",
			providerId: provider,
			models: parsed.models ?? [],
		});
	}

	private async sendPrompt(
		prompt: string,
		config?: {
			provider?: string;
			model?: string;
			systemPrompt?: string;
			maxIterations?: number;
			enableTools?: boolean;
			enableSpawn?: boolean;
			enableTeams?: boolean;
			autoApproveTools?: boolean;
		},
	): Promise<void> {
		const trimmedPrompt = prompt.trim();
		if (!trimmedPrompt) {
			return;
		}
		if (this.sending) {
			await this.post({
				type: "status",
				text: "A turn is already in progress.",
			});
			return;
		}

		this.sending = true;
		this.streamedAssistantText = "";
		try {
			const startConfig = await this.ensureSession(config);
			const client = await this.getClient();
			const request: RpcChatRunTurnRequest = {
				config: startConfig,
				prompt: trimmedPrompt,
			};
			const response = await client.sendRuntimeSession(
				this.sessionId as string,
				request,
			);
			const parsed = response.result as RpcChatTurnResult;
			this.emitRemainder(parsed.text);
			await this.post({
				type: "turn_done",
				finishReason: parsed.finishReason,
				iterations: parsed.iterations,
				usage: parsed.usage,
			});
		} catch (error) {
			await this.postError(error);
		} finally {
			this.sending = false;
		}
	}

	private emitRemainder(fullText: string): void {
		if (!fullText) {
			return;
		}
		if (fullText.startsWith(this.streamedAssistantText)) {
			const remainder = fullText.slice(this.streamedAssistantText.length);
			if (remainder) {
				this.streamedAssistantText = fullText;
				void this.post({ type: "assistant_delta", text: remainder });
			}
			return;
		}
		if (fullText !== this.streamedAssistantText) {
			this.streamedAssistantText = fullText;
			void this.post({ type: "assistant_delta", text: fullText });
		}
	}

	private async ensureSession(config?: {
		provider?: string;
		model?: string;
		systemPrompt?: string;
		maxIterations?: number;
		enableTools?: boolean;
		enableSpawn?: boolean;
		enableTeams?: boolean;
		autoApproveTools?: boolean;
	}): Promise<RpcChatStartSessionRequest> {
		if (this.sessionId && this.startConfig) {
			return this.startConfig;
		}

		const defaults = this.resolveWorkspaceDefaults();
		const provider = config?.provider?.trim() || "cline";
		const model = config?.model?.trim() || "openai/gpt-5.3-codex";
		const normalizedMaxIterations =
			typeof config?.maxIterations === "number" && config.maxIterations > 0
				? Math.floor(config.maxIterations)
				: undefined;
		const request: RpcChatStartSessionRequest = {
			workspaceRoot: defaults.workspaceRoot,
			cwd: defaults.cwd,
			provider,
			model,
			mode: "act",
			apiKey: "",
			systemPrompt: config?.systemPrompt?.trim() || undefined,
			maxIterations: normalizedMaxIterations,
			enableTools: config?.enableTools !== false,
			enableSpawn: config?.enableSpawn !== false,
			enableTeams: config?.enableTeams === true,
			autoApproveTools: config?.autoApproveTools !== false,
			teamName: "vscode-chat",
			missionStepInterval: 3,
			missionTimeIntervalMs: 120000,
		};
		const client = await this.getClient();
		const response = await client.startRuntimeSession(request);
		const sessionId = response.sessionId.trim();
		if (!sessionId) {
			throw new Error("RPC runtime returned an empty session id");
		}
		this.sessionId = sessionId;
		this.startConfig = request;
		this.startEventStream(sessionId);
		await this.post({ type: "session_started", sessionId });
		return request;
	}

	private startEventStream(sessionId: string): void {
		this.stopEventStream();
		const client = this.client;
		if (!client) {
			return;
		}
		this.stopStreaming = client.streamEvents(
			{
				clientId: this.streamClientId,
				sessionIds: [sessionId],
			},
			{
				onEvent: (event) => {
					if (event.eventType === "runtime.chat.text_delta") {
						const payload = event.payload;
						const accumulated =
							typeof payload.accumulated === "string"
								? payload.accumulated
								: undefined;
						const delta =
							typeof payload.text === "string"
								? payload.text
								: accumulated?.startsWith(this.streamedAssistantText)
									? accumulated.slice(this.streamedAssistantText.length)
									: "";
						if (!delta) {
							if (accumulated) {
								this.streamedAssistantText = accumulated;
							}
							return;
						}
						this.streamedAssistantText += delta;
						void this.post({ type: "assistant_delta", text: delta });
						return;
					}
					if (event.eventType === "runtime.chat.tool_call_start") {
						const payload = event.payload;
						const toolName =
							typeof payload.toolName === "string" ? payload.toolName : "tool";
						void this.post({
							type: "tool_event",
							text: `Running ${toolName}...`,
						});
						return;
					}
					if (event.eventType === "runtime.chat.tool_call_end") {
						const payload = event.payload;
						const toolName =
							typeof payload.toolName === "string" ? payload.toolName : "tool";
						const error =
							typeof payload.error === "string" ? payload.error : undefined;
						void this.post({
							type: "tool_event",
							text: error
								? `${toolName} failed: ${error}`
								: `${toolName} completed`,
						});
					}
				},
				onError: (error) => {
					void this.postError(error);
				},
			},
		);
	}

	private async abortTurn(): Promise<void> {
		if (!this.sessionId) {
			return;
		}
		try {
			const client = await this.getClient();
			await client.abortRuntimeSession(this.sessionId);
			await this.post({ type: "status", text: "Abort requested." });
		} catch (error) {
			await this.postError(error);
		}
	}

	private async resetSession(): Promise<void> {
		if (this.sessionId && this.client) {
			try {
				await this.client.stopRuntimeSession(this.sessionId);
			} catch {
				// ignore stop errors on reset
			}
		}
		this.stopEventStream();
		this.sessionId = undefined;
		this.startConfig = undefined;
		this.sending = false;
		this.streamedAssistantText = "";
		await this.post({ type: "reset_done" });
	}

	private stopEventStream(): void {
		if (this.stopStreaming) {
			this.stopStreaming();
			this.stopStreaming = undefined;
		}
	}

	private async getClient(): Promise<RpcSessionClient> {
		await this.ensureRpcAddress();
		if (!this.client) {
			throw new Error("RPC client is not initialized");
		}
		return this.client;
	}

	private async post(message: WebviewOutboundMessage): Promise<void> {
		await this.panel.webview.postMessage(message);
	}

	private async postError(error: unknown): Promise<void> {
		const text = error instanceof Error ? error.message : String(error);
		await this.post({ type: "error", text });
	}
}

function createNonce(): string {
	const chars =
		"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
	let nonce = "";
	for (let index = 0; index < 32; index += 1) {
		nonce += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return nonce;
}
