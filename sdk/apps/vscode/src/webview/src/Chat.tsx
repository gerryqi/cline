"use client";

import { PlusIcon } from "lucide-react";
import { nanoid } from "nanoid";
import {
	type MutableRefObject,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	Conversation,
	ConversationContent,
	ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
	Message,
	MessageContent,
	MessageResponse,
} from "@/components/ai-elements/message";
import { PromptInputProvider } from "@/components/ai-elements/prompt-input";
import {
	Tool,
	ToolContent,
	ToolHeader,
	ToolOutput,
} from "@/components/ai-elements/tool";
import TeamTasks, { type TeamToolEvent } from "@/components/TeamTasks";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
	WebviewDefaults,
	WebviewOutboundMessage,
	WebviewProviderModel,
	WebviewToolEvent,
} from "../../webview-protocol";
import { Composer } from "./components/Composer";
import type {
	ChatMessage,
	ModelSelectionStorage,
	ProviderOption,
	ToolEvent,
} from "./types";
import { getVsCodeApi, postToHost } from "./vscode";

const EMPTY_SELECTION: ModelSelectionStorage = {
	lastProvider: "",
	lastModelByProvider: {},
};

function readModelSelection(): ModelSelectionStorage {
	try {
		const state = getVsCodeApi()?.getState() as
			| { modelSelection?: ModelSelectionStorage }
			| undefined;
		if (state?.modelSelection) {
			return state.modelSelection;
		}
	} catch {
		// ignore persisted state issues in the webview
	}
	return EMPTY_SELECTION;
}

function writeModelSelection(selection: ModelSelectionStorage): void {
	try {
		const api = getVsCodeApi();
		if (!api) {
			return;
		}
		const state = (api.getState() as Record<string, unknown>) ?? {};
		api.setState({ ...state, modelSelection: selection });
	} catch {
		// ignore persisted state issues in the webview
	}
}

function parseMaxIterations(value: string): number | undefined {
	const parsed = Number.parseInt(value, 10);
	return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function createMessage(
	role: ChatMessage["role"],
	text: string,
	extra?: Partial<ChatMessage>,
): ChatMessage {
	return {
		id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
		role,
		text,
		...extra,
	};
}

function appendAssistantDelta(
	current: ChatMessage[],
	text: string,
	activeAssistantIdRef: MutableRefObject<string | undefined>,
): ChatMessage[] {
	if (!text) {
		return current;
	}

	const activeAssistantId = activeAssistantIdRef.current;
	if (activeAssistantId) {
		const targetIndex = current.findIndex(
			(message) => message.id === activeAssistantId,
		);
		if (targetIndex >= 0) {
			return current.map((message, index) =>
				index === targetIndex
					? { ...message, text: `${message.text}${text}` }
					: message,
			);
		}
	}

	const lastMessage = current.at(-1);
	if (lastMessage?.role === "assistant") {
		activeAssistantIdRef.current = lastMessage.id;
		return [
			...current.slice(0, -1),
			{ ...lastMessage, text: `${lastMessage.text}${text}` },
		];
	}

	const assistantMessage = createMessage("assistant", text);
	activeAssistantIdRef.current = assistantMessage.id;
	return [...current, assistantMessage];
}

type ToolResultEntry = {
	query?: string;
	result?: string;
	success?: boolean;
};

function isToolResultArray(value: unknown): value is ToolResultEntry[] {
	return (
		Array.isArray(value) &&
		value.length > 0 &&
		typeof value[0] === "object" &&
		value[0] !== null &&
		"result" in value[0]
	);
}

type ExpandedToolEvent = {
	id: string;
	name: string;
	title: string;
	state: ToolEvent["state"];
	output: string;
	error?: string;
};

function formatInputSummary(input: unknown): string {
	if (input == null) {
		return "";
	}
	if (typeof input === "string") {
		return input;
	}
	if (typeof input === "object") {
		const values = Object.values(input as Record<string, unknown>);
		return values
			.filter((v) => typeof v === "string" || typeof v === "number")
			.map(String)
			.join(" ");
	}
	return String(input);
}

function formatRawOutput(output: unknown, fallback: string): string {
	if (output == null) {
		return fallback;
	}
	if (typeof output === "string") {
		return output;
	}
	return JSON.stringify(output, null, 2);
}

function expandToolEvent(toolEvent: ToolEvent): ExpandedToolEvent[] {
	if (isToolResultArray(toolEvent.output)) {
		return toolEvent.output.map((entry, index) => {
			const query = entry.query ?? "";
			const title = query ? `${toolEvent.name}: ${query}` : toolEvent.name;
			const state: ToolEvent["state"] =
				entry.success === false ? "output-error" : toolEvent.state;
			const output =
				entry.result ?? (entry.success === false ? "(failed)" : "(no output)");
			const error =
				entry.success === false ? (entry.result ?? "failed") : undefined;
			return {
				id: `${toolEvent.id}-${index}`,
				name: toolEvent.name,
				title,
				state,
				output,
				error,
			};
		});
	}

	const inputSummary = formatInputSummary(toolEvent.input);
	const title = inputSummary
		? `${toolEvent.name}: ${inputSummary}`
		: toolEvent.name;

	return [
		{
			id: toolEvent.id,
			name: toolEvent.name,
			title,
			state: toolEvent.state,
			output:
				toolEvent.error ?? formatRawOutput(toolEvent.output, toolEvent.text),
			error: toolEvent.error,
		},
	];
}

function extractToolName(text: string): string {
	const runningMatch = /^Running (.+)\.\.\.$/.exec(text);
	if (runningMatch?.[1]) {
		return runningMatch[1];
	}
	const terminalMatch = /^(.+?) (completed|failed:.*)$/.exec(text);
	return terminalMatch?.[1] ?? "tool";
}

function deriveToolState(text: string): ToolEvent["state"] {
	if (text.includes("failed:")) {
		return "output-error";
	}
	if (text.endsWith("completed")) {
		return "output-available";
	}
	return "input-available";
}

function mapToolEventState(
	event?: WebviewToolEvent,
	fallbackText?: string,
): ToolEvent["state"] {
	if (event?.status === "failed") {
		return "output-error";
	}
	if (event?.status === "completed") {
		return "output-available";
	}
	if (event?.status === "running") {
		return "input-available";
	}
	return deriveToolState(fallbackText ?? "");
}

function upsertToolEvent(events: ToolEvent[], next: ToolEvent): ToolEvent[] {
	const existingIndex = events.findIndex(
		(event) =>
			(event.toolCallId &&
				next.toolCallId &&
				event.toolCallId === next.toolCallId) ||
			(!event.toolCallId &&
				!next.toolCallId &&
				event.name === next.name &&
				event.state === "input-available" &&
				next.state !== "input-available"),
	);

	if (existingIndex === -1) {
		return [...events, next];
	}

	return events.map((event, index) =>
		index === existingIndex
			? {
					...event,
					text: next.text,
					state: next.state,
					output: next.output,
					error: next.error,
				}
			: event,
	);
}

function appendToolEvent(
	current: ChatMessage[],
	text: string,
	event: WebviewToolEvent | undefined,
	activeAssistantIdRef: MutableRefObject<string | undefined>,
): ChatMessage[] {
	const activeAssistantId = activeAssistantIdRef.current;
	const toolEvent: ToolEvent = {
		id: nanoid(),
		toolCallId: event?.toolCallId,
		name: event?.toolName ?? extractToolName(text),
		state: mapToolEventState(event, text),
		text,
		input: event?.input,
		output: event?.output,
		error: event?.error,
	};

	if (activeAssistantId) {
		return current.map((message) =>
			message.id === activeAssistantId
				? {
						...message,
						toolEvents: upsertToolEvent(message.toolEvents ?? [], toolEvent),
					}
				: message,
		);
	}

	return [...current, createMessage("meta", text, { toolEvents: [toolEvent] })];
}

function finalizeAssistantTurn(
	current: ChatMessage[],
	finishReason: string,
	iterations: number,
	usage?: {
		inputTokens?: number;
		outputTokens?: number;
	},
): ChatMessage[] {
	return [
		...current,
		createMessage(
			"meta",
			`Done (${finishReason}) • iterations=${iterations} • input=${usage?.inputTokens ?? 0} output=${usage?.outputTokens ?? 0}`,
		),
	];
}

export default function Chat() {
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [status, setStatus] = useState("Waiting for RPC initialization...");
	const [sessionId, setSessionId] = useState<string>();
	const [sending, setSending] = useState(false);
	const [providers, setProviders] = useState<ProviderOption[]>([]);
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
	const [mode, setMode] = useState<"act" | "plan">("act");
	const [thinking, setThinking] = useState(false);
	const [enableTools, setEnableTools] = useState(true);
	const [enableSpawn, setEnableSpawn] = useState(true);
	const [enableTeams, setEnableTeams] = useState(false);
	const [autoApproveTools, setAutoApproveTools] = useState(true);
	const [modelSelectorOpen, setModelSelectorOpen] = useState(false);
	const activeAssistantIdRef = useRef<string | undefined>(undefined);
	const lastSelectionRef = useRef(lastSelection);

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
					activeAssistantIdRef.current = undefined;
					setMessages((current) => [
						...current,
						createMessage("error", `Error: ${message.text}`),
					]);
					return;
				case "defaults":
					setDefaults(message.defaults);
					return;
				case "providers":
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
				case "models":
					setModelsByProvider((current) => ({
						...current,
						[message.providerId]: message.models,
					}));
					setModel((current) => {
						if (current && message.models.some((item) => item.id === current)) {
							return current;
						}
						const saved = readModelSelection();
						const rememberedModel =
							saved.lastModelByProvider[message.providerId];
						if (
							rememberedModel &&
							message.models.some((item) => item.id === rememberedModel)
						) {
							return rememberedModel;
						}
						return message.models[0]?.id || "";
					});
					return;
				case "session_started":
					setSessionId(message.sessionId);
					return;
				case "assistant_delta":
					setMessages((current) =>
						appendAssistantDelta(current, message.text, activeAssistantIdRef),
					);
					return;
				case "tool_event":
					setMessages((current) =>
						appendToolEvent(
							current,
							message.text,
							message.event,
							activeAssistantIdRef,
						),
					);
					return;
				case "turn_done":
					setStatus(`Done (${message.finishReason})`);
					setSending(false);
					activeAssistantIdRef.current = undefined;
					setMessages((current) =>
						finalizeAssistantTurn(
							current,
							message.finishReason,
							message.iterations,
							message.usage,
						),
					);
					return;
				case "reset_done":
					setSessionId(undefined);
					setSending(false);
					activeAssistantIdRef.current = undefined;
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

	useEffect(() => {
		if (!provider || !model) {
			return;
		}
		const previous = lastSelectionRef.current;
		if (
			previous.lastProvider === provider &&
			previous.lastModelByProvider[provider] === model
		) {
			return;
		}
		const nextSelection: ModelSelectionStorage = {
			lastProvider: provider,
			lastModelByProvider: {
				...previous.lastModelByProvider,
				[provider]: model,
			},
		};
		lastSelectionRef.current = nextSelection;
		setLastSelection(nextSelection);
		writeModelSelection(nextSelection);
	}, [provider, model]);

	const models = modelsByProvider[provider] ?? [];
	const thinkingEnabled =
		thinking &&
		models.find((item) => item.id === model)?.supportsThinking === true;
	const visibleMessages = useMemo(
		() => messages.filter((message) => message.role !== "meta" || message.text),
		[messages],
	);

	return (
		<PromptInputProvider>
			<div className="relative flex h-screen flex-col overflow-hidden">
				<div className="flex items-center justify-between border-b px-4 py-3">
					<div className="min-w-0">
						<p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
							Cline
						</p>
					</div>
					<div className="flex items-center gap-2">
						{sessionId ? (
							<code className="rounded-full bg-muted px-3 py-1 text-xs">
								{sessionId}
							</code>
						) : null}
						<Button
							onClick={() => {
								postToHost({ type: "reset" });
								setStatus("Resetting session...");
							}}
							size="icon-sm"
							type="button"
							variant="ghost"
						>
							<PlusIcon className="size-4" />
							<span className="sr-only">New chat</span>
						</Button>
					</div>
				</div>
				<Conversation className="min-h-0 flex-1">
					<ConversationContent className="px-4 py-5">
						{visibleMessages.length === 0 ? (
							<div className="flex h-full items-center align-middle justify-center rounded-xl border border-dashed px-6 py-16 text-center text-sm text-muted-foreground">
								How can I help you?
							</div>
						) : null}
						{visibleMessages.map((message) => {
							const teamToolEvents =
								message.toolEvents?.filter((toolEvent) =>
									toolEvent.name.startsWith("team_"),
								) ?? [];
							const standardToolEvents =
								message.toolEvents?.filter(
									(toolEvent) => !toolEvent.name.startsWith("team_"),
								) ?? [];

							if (message.role === "meta" || message.role === "error") {
								return (
									<div
										className={cn(
											"w-full rounded-lg border px-4 py-3 text-sm",
											message.role === "error"
												? "border-destructive/40 bg-destructive/10 text-destructive"
												: "bg-muted/40 text-muted-foreground",
										)}
										key={message.id}
									>
										<pre className="whitespace-pre-wrap font-inherit">
											{message.text}
										</pre>
										{teamToolEvents.length > 0 ? (
											<TeamTasks
												className="mt-3 w-full"
												events={teamToolEvents as TeamToolEvent[]}
											/>
										) : null}
										{standardToolEvents.flatMap((toolEvent) =>
											expandToolEvent(toolEvent).map((expanded) => (
												<Tool className="mt-3" key={expanded.id}>
													<ToolHeader
														state={expanded.state}
														title={expanded.title}
														type="dynamic-tool"
														toolName={expanded.name}
													/>
													<ToolContent>
														<ToolOutput
															errorText={expanded.error}
															output={expanded.output}
														/>
													</ToolContent>
												</Tool>
											)),
										)}
									</div>
								);
							}

							return (
								<Message from={message.role} key={message.id}>
									<div>
										{teamToolEvents.length > 0 ? (
											<TeamTasks
												className="mb-3 w-full"
												events={teamToolEvents as TeamToolEvent[]}
											/>
										) : null}
										{standardToolEvents.flatMap((toolEvent) =>
											expandToolEvent(toolEvent).map((expanded) => (
												<Tool className="mb-3" key={expanded.id}>
													<ToolHeader
														state={expanded.state}
														title={expanded.title}
														type="dynamic-tool"
														toolName={expanded.name}
													/>
													<ToolContent>
														<ToolOutput
															errorText={expanded.error}
															output={expanded.output}
														/>
													</ToolContent>
												</Tool>
											)),
										)}
										<MessageContent>
											<MessageResponse>{message.text}</MessageResponse>
										</MessageContent>
									</div>
								</Message>
							);
						})}
					</ConversationContent>
					<ConversationScrollButton />
				</Conversation>
				<Composer
					autoApproveTools={autoApproveTools}
					enableSpawn={enableSpawn}
					enableTeams={enableTeams}
					enableTools={enableTools}
					maxIterations={maxIterations}
					model={model}
					mode={mode}
					modelSelectorOpen={modelSelectorOpen}
					models={models}
					onAbort={() => {
						postToHost({ type: "abort" });
						setStatus("Abort requested...");
					}}
					onAutoApproveToolsChange={setAutoApproveTools}
					onEnableSpawnChange={setEnableSpawn}
					onEnableTeamsChange={setEnableTeams}
					onEnableToolsChange={setEnableTools}
					onModeChange={setMode}
					onMaxIterationsChange={setMaxIterations}
					onModelChange={setModel}
					onModelSelectorOpenChange={setModelSelectorOpen}
					onProviderChange={(nextProvider) => {
						setProvider(nextProvider);
						const rememberedModel =
							lastSelection.lastModelByProvider[nextProvider];
						const providerModelIds = (modelsByProvider[nextProvider] ?? []).map(
							(item) => item.id,
						);
						if (rememberedModel && providerModelIds.includes(rememberedModel)) {
							setModel(rememberedModel);
							return;
						}
						setModel("");
					}}
					onSend={(prompt) => {
						const assistantMessage = createMessage("assistant", "");
						activeAssistantIdRef.current = assistantMessage.id;
						setMessages((current) => [
							...current,
							createMessage("user", prompt),
							assistantMessage,
						]);
						setSending(true);
						setStatus("Running...");
						postToHost({
							type: "send",
							prompt,
							config: {
								autoApproveTools,
								enableSpawn,
								enableTeams,
								enableTools,
								maxIterations: parseMaxIterations(maxIterations),
								model: model || undefined,
								mode,
								provider: provider || undefined,
								systemPrompt: systemPrompt.trim() || undefined,
								thinking: thinkingEnabled,
							},
						});
					}}
					onSystemPromptChange={setSystemPrompt}
					onThinkingChange={setThinking}
					provider={provider}
					providers={providers}
					sending={sending}
					status={status}
					systemPrompt={systemPrompt}
					thinking={thinkingEnabled}
					workspaceRoot={defaults.workspaceRoot}
				/>
			</div>
		</PromptInputProvider>
	);
}
