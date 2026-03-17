import { useEffect, useRef, useState } from "react";
import type {
	WebviewDefaults,
	WebviewOutboundMessage,
	WebviewProviderModel,
} from "../../webview-protocol";
import "./App.css";
import { ChatInputBar } from "./components/chat-input";
import { type ChatMessageItem, ChatMessages } from "./components/chat-messages";
import { getVsCodeApi, postToHost } from "./vscode";

type ModelSelectionStorage = {
	lastProvider: string;
	lastModelByProvider: Record<string, string>;
};

function readModelSelection(): ModelSelectionStorage {
	const empty: ModelSelectionStorage = {
		lastProvider: "",
		lastModelByProvider: {},
	};
	try {
		const state = getVsCodeApi()?.getState() as
			| { modelSelection?: ModelSelectionStorage }
			| undefined;
		if (state?.modelSelection) {
			return state.modelSelection;
		}
	} catch {
		// ignore
	}
	return empty;
}

function writeModelSelection(selection: ModelSelectionStorage): void {
	try {
		const api = getVsCodeApi();
		if (!api) return;
		const state = (api.getState() as Record<string, unknown>) ?? {};
		api.setState({ ...state, modelSelection: selection });
	} catch {
		// ignore
	}
}

function App() {
	const [messages, setMessages] = useState<ChatMessageItem[]>([]);
	const [status, setStatus] = useState("Waiting for RPC initialization...");
	const [sessionId, setSessionId] = useState<string>();
	const [sending, setSending] = useState(false);
	const [providers, setProviders] = useState<
		Array<{
			id: string;
			name: string;
			enabled: boolean;
			defaultModelId?: string;
		}>
	>([]);
	const [modelsByProvider, setModelsByProvider] = useState<
		Record<string, WebviewProviderModel[]>
	>({});
	const [defaults, setDefaults] = useState<WebviewDefaults>({
		workspaceRoot: "",
		cwd: "",
	});
	const [lastSelection, setLastSelection] =
		useState<ModelSelectionStorage>(readModelSelection);
	const [provider, setProvider] = useState(() => lastSelection.lastProvider);
	const [model, setModel] = useState(
		() => lastSelection.lastModelByProvider[lastSelection.lastProvider] ?? "",
	);
	const [systemPrompt, setSystemPrompt] = useState("");
	const [maxIterations, setMaxIterations] = useState("");
	const [enableTools, setEnableTools] = useState(true);
	const [enableSpawn, setEnableSpawn] = useState(true);
	const [enableTeams, setEnableTeams] = useState(false);
	const [autoApproveTools, setAutoApproveTools] = useState(true);

	useEffect(() => {
		const handleMessage = (event: MessageEvent<WebviewOutboundMessage>) => {
			const message = event.data;
			if (!message || typeof message !== "object" || !("type" in message)) {
				return;
			}

			switch (message.type) {
				case "status":
					setStatus(message.text);
					return;
				case "error":
					setStatus(`Error: ${message.text}`);
					setSending(false);
					setMessages((current) => [
						...current,
						createMessage("error", `Error: ${message.text}`),
					]);
					return;
				case "defaults":
					setDefaults(message.defaults);
					return;
				case "providers": {
					setProviders(message.providers);
					setProvider((current) => {
						const nextProvider =
							current ||
							message.providers.find((item) => item.enabled)?.id ||
							message.providers[0]?.id ||
							"";
						if (nextProvider) {
							postToHost({ type: "loadModels", providerId: nextProvider });
						}
						return nextProvider;
					});
					return;
				}
				case "models":
					setModelsByProvider((current) => ({
						...current,
						[message.providerId]: message.models,
					}));
					setModel((current) => {
						if (current) return current;
						const saved = readModelSelection();
						const rememberedModel =
							saved.lastModelByProvider[message.providerId];
						const modelIds = message.models.map((m) => m.id);
						if (rememberedModel && modelIds.includes(rememberedModel)) {
							return rememberedModel;
						}
						return message.models[0]?.id || "";
					});
					return;
				case "session_started":
					setSessionId(message.sessionId);
					return;
				case "assistant_delta":
					setMessages((current) => appendAssistantDelta(current, message.text));
					return;
				case "tool_event":
					setMessages((current) => [
						...current,
						createMessage("meta", message.text),
					]);
					return;
				case "turn_done":
					setStatus(`Done (${message.finishReason})`);
					setSending(false);
					setMessages((current) => [
						...current,
						createMessage(
							"meta",
							`Done (${message.finishReason}) • iterations=${message.iterations} • input=${message.usage?.inputTokens ?? 0} output=${message.usage?.outputTokens ?? 0}`,
						),
					]);
					return;
				case "reset_done":
					setSessionId(undefined);
					setSending(false);
					setStatus("Started a new chat session.");
					setMessages([]);
					return;
			}
		};

		window.addEventListener("message", handleMessage);
		postToHost({ type: "ready" });
		return () => {
			window.removeEventListener("message", handleMessage);
		};
	}, []);

	useEffect(() => {
		if (provider) {
			postToHost({ type: "loadModels", providerId: provider });
		}
	}, [provider]);

	// Persist model selection changes
	const lastSelectionRef = useRef(lastSelection);
	useEffect(() => {
		if (!provider || !model) return;
		const prev = lastSelectionRef.current;
		if (
			prev.lastProvider === provider &&
			prev.lastModelByProvider[provider] === model
		) {
			return;
		}
		const next: ModelSelectionStorage = {
			lastProvider: provider,
			lastModelByProvider: {
				...prev.lastModelByProvider,
				[provider]: model,
			},
		};
		lastSelectionRef.current = next;
		setLastSelection(next);
		writeModelSelection(next);
	}, [provider, model]);

	const models = modelsByProvider[provider] ?? [];

	return (
		<div className="app-shell">
			<ChatMessages
				_messages={messages}
				status={status}
				sessionId={sessionId}
				sending={sending}
			/>
			<ChatInputBar
				providers={providers}
				models={models}
				provider={provider}
				model={model}
				workspaceRoot={defaults.workspaceRoot}
				systemPrompt={systemPrompt}
				maxIterations={maxIterations}
				enableTools={enableTools}
				enableSpawn={enableSpawn}
				enableTeams={enableTeams}
				autoApproveTools={autoApproveTools}
				sending={sending}
				status={status}
				onProviderChange={(nextProvider) => {
					setProvider(nextProvider);
					const rememberedModel =
						lastSelection.lastModelByProvider[nextProvider];
					const providerModelIds = (modelsByProvider[nextProvider] ?? []).map(
						(m) => m.id,
					);
					if (rememberedModel && providerModelIds.includes(rememberedModel)) {
						setModel(rememberedModel);
					} else {
						setModel("");
					}
				}}
				onModelChange={setModel}
				onSystemPromptChange={setSystemPrompt}
				onMaxIterationsChange={setMaxIterations}
				onEnableToolsChange={setEnableTools}
				onEnableSpawnChange={setEnableSpawn}
				onEnableTeamsChange={setEnableTeams}
				onAutoApproveToolsChange={setAutoApproveTools}
				onSend={(prompt) => {
					setMessages((current) => [...current, createMessage("user", prompt)]);
					setSending(true);
					setStatus("Running...");
					postToHost({
						type: "send",
						prompt,
						config: {
							provider: provider || undefined,
							model: model || undefined,
							systemPrompt: systemPrompt.trim() || undefined,
							maxIterations: parseMaxIterations(maxIterations),
							enableTools,
							enableSpawn,
							enableTeams,
							autoApproveTools,
						},
					});
				}}
				onAbort={() => {
					postToHost({ type: "abort" });
					setStatus("Abort requested...");
				}}
				onReset={() => {
					postToHost({ type: "reset" });
					setStatus("Resetting session...");
				}}
			/>
		</div>
	);
}

function parseMaxIterations(value: string): number | undefined {
	const parsed = Number.parseInt(value, 10);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function createMessage(
	role: ChatMessageItem["role"],
	text: string,
): ChatMessageItem {
	return {
		id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
		role,
		text,
	};
}

function appendAssistantDelta(
	current: ChatMessageItem[],
	text: string,
): ChatMessageItem[] {
	const lastMessage = current.at(-1);
	if (lastMessage?.role === "assistant") {
		return [
			...current.slice(0, -1),
			{ ...lastMessage, text: `${lastMessage.text}${text}` },
		];
	}
	return [...current, createMessage("assistant", text)];
}

export default App;
