"use client";

import {
	Bot,
	ChevronDown,
	ChevronRight,
	FileEdit,
	FileSearch,
	Loader2,
	Search,
	Terminal,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ChatMessage, ChatSessionStatus } from "@/lib/chat-schema";
import { cn } from "@/lib/utils";
import { MemoizedMarkdown } from "./ui/markdown";

type ChatMessagesProps = {
	sessionId: string | null;
	status: ChatSessionStatus;
	provider: string;
	model: string;
	messages: ChatMessage[];
	error: string | null;
	promptInput: string;
	onPromptInputChange: (value: string) => void;
	onSend: () => void;
};

export function ChatMessages({
	sessionId,
	status,
	provider,
	model,
	messages,
	error,
}: ChatMessagesProps) {
	const hasMessages = messages.length > 0;
	const lastErrorMessage = [...messages]
		.reverse()
		.find((message) => message.role === "error");
	const shouldShowErrorBanner =
		Boolean(error) && (!lastErrorMessage || lastErrorMessage.content !== error);

	return (
		<ScrollArea className="h-full min-h-0">
			<div className="mx-auto w-full px-6 py-6">
				{!hasMessages ? (
					<div className="rounded-xl border border-border bg-card p-4 text-sm text-muted-foreground">
						<div>
							{provider} / {model}
						</div>
						<div className="mt-1">Session: {sessionId ?? "not started"}</div>
						<div className="mt-1">Status: {status}</div>
					</div>
				) : (
					<div className="flex flex-col gap-2 h-full">
						{messages.map((message) => (
							<MessageBubble key={message.id} message={message} />
						))}
					</div>
				)}
				{status === "starting" ? (
					<div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
						<Loader2 className="h-4 w-4 animate-spin" />
						Thinking...
					</div>
				) : null}
				{shouldShowErrorBanner ? (
					<div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
						{error}
					</div>
				) : null}
			</div>
		</ScrollArea>
	);
}

function MessageBubble({ message }: { message: ChatMessage }) {
	const isUser = message.role === "user";
	const isError = message.role === "error";

	if (message.role === "tool") {
		return <ToolMessageBlock message={message} />;
	}

	const normalizedContent = message.content.replace(
		/<user_input>(.*?)<\/user_input>/g,
		"$1",
	);

	return (
		<div
			className={cn("flex", isUser ? "justify-end" : "justify-start w-full")}
		>
			<div
				className={cn(
					"rounded-xl px-4 text-sm overflow-hidden",
					isUser && "max-w-[85%] bg-card text-foreground/80 text-right",
					!isUser && !isError && "text-foreground w-full",
					isError &&
						"bg-destructive/10 border border-destructive/40 text-destructive",
				)}
			>
				<MemoizedMarkdown content={normalizedContent || " "} id={message.id} />
			</div>
		</div>
	);
}

type ToolPayload = {
	toolName?: string;
	input?: unknown;
	result?: unknown;
	isError?: boolean;
};

type ToolSummary = {
	label: string;
	details: string[];
};

function parseToolPayload(raw: string): ToolPayload | null {
	try {
		return JSON.parse(raw) as ToolPayload;
	} catch {
		return null;
	}
}

function classifyTool(
	toolName: string,
): "exploration" | "file-edit" | "bash" | "spawn" | "tool" {
	const normalized = toolName.toLowerCase();
	if (
		[
			"search",
			"search_codebase",
			"file-read",
			"file_read",
			"read_files",
			"web-fetch",
			"web_fetch",
			"fetch_web_content",
			"skills",
		].includes(normalized)
	)
		return "exploration";
	if (["editor", "edit_file", "edit"].includes(normalized)) return "file-edit";
	if (["bash", "run_commands"].includes(normalized)) return "bash";
	if (["spawn_agent", "spawn-agent", "spawn_agent_tool"].includes(normalized))
		return "spawn";
	return "tool";
}

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

function asStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.filter(
		(item): item is string => typeof item === "string" && item.length > 0,
	);
}

function toDisplayPath(path: string): string {
	const parts = path.split(/[\\/]/);
	return parts.at(-1) || path;
}

function parseDiffCounts(
	value: unknown,
): { additions: number; deletions: number } | null {
	if (typeof value !== "string") return null;
	const lines = value.split("\n");
	let additions = 0;
	let deletions = 0;

	for (const line of lines) {
		if (/^\+\d+:/.test(line)) additions += 1;
		if (/^-\d+:/.test(line)) deletions += 1;
	}

	if (additions === 0 && deletions === 0) return null;
	return { additions, deletions };
}

function pluralize(
	count: number,
	singular: string,
	plural = `${singular}s`,
): string {
	return `${count} ${count === 1 ? singular : plural}`;
}

function buildToolSummary(
	toolName: string,
	input: unknown,
	result: unknown,
	inProgress: boolean,
): ToolSummary {
	const normalized = toolName.toLowerCase();
	const inputObject = asRecord(input);

	if (["read_files", "file_read", "file-read"].includes(normalized)) {
		const files = asStringArray(inputObject?.file_paths);
		if (files.length > 0) {
			return {
				label: `${inProgress ? "Exploring" : "Explored"} ${pluralize(files.length, "file")}`,
				details: files.map(
					(file) => `${inProgress ? "Reading" : "Read"} ${toDisplayPath(file)}`,
				),
			};
		}
	}

	if (["search_codebase", "search"].includes(normalized)) {
		const queries = asStringArray(inputObject?.queries);
		if (queries.length > 0) {
			return {
				label: `${inProgress ? "Exploring" : "Explored"} ${pluralize(queries.length, "search")}`,
				details: queries.map(
					(query) =>
						`${inProgress ? "Searching for" : "Searched for"} ${query}`,
				),
			};
		}
	}

	if (["run_commands", "bash"].includes(normalized)) {
		const commands = asStringArray(inputObject?.commands);
		if (commands.length === 1) {
			return {
				label: `${inProgress ? "Running" : "Ran"} ${commands[0]}`,
				details: [`${inProgress ? "Running" : "Ran"} ${commands[0]}`],
			};
		}
		if (commands.length > 1) {
			return {
				label: `${inProgress ? "Running" : "Ran"} ${pluralize(commands.length, "command")}`,
				details: commands.map(
					(command) => `${inProgress ? "Running" : "Ran"} ${command}`,
				),
			};
		}
	}

	if (["fetch_web_content", "web_fetch", "web-fetch"].includes(normalized)) {
		const requests = Array.isArray(inputObject?.requests)
			? inputObject.requests
			: [];
		const urls = requests
			.map((request) => {
				const requestObject = asRecord(request);
				return typeof requestObject?.url === "string"
					? requestObject.url
					: null;
			})
			.filter((url): url is string => Boolean(url));
		if (urls.length > 0) {
			return {
				label: `${inProgress ? "Exploring" : "Explored"} ${pluralize(urls.length, "link")}`,
				details: urls.map(
					(url) => `${inProgress ? "Fetching" : "Fetched"} ${url}`,
				),
			};
		}
	}

	if (["editor", "edit_file", "edit"].includes(normalized)) {
		const command =
			typeof inputObject?.command === "string" ? inputObject.command : "edit";
		const path =
			typeof inputObject?.path === "string"
				? toDisplayPath(inputObject.path)
				: "file";
		const diff = parseDiffCounts(asRecord(result)?.result);
		const action = inProgress
			? command === "str_replace"
				? "Editing"
				: command === "create"
					? "Creating"
					: command === "insert"
						? "Inserting"
						: "Editing"
			: command === "str_replace"
				? "Edited"
				: command === "create"
					? "Created"
					: command === "insert"
						? "Inserted"
						: "Edited";
		const detail = `${action} ${path}`;
		if (diff) {
			return {
				label: `${detail} +${diff.additions} -${diff.deletions}`,
				details: [detail],
			};
		}
		return { label: detail, details: [detail] };
	}

	const query =
		typeof asRecord(result)?.query === "string"
			? (asRecord(result)?.query as string)
			: "";
	const fallback =
		query || (inProgress ? `Running ${toolName}` : toolName) || "Tool";
	return { label: fallback, details: [fallback] };
}

function buildToolSummaryFromMeta(
	toolName: string,
	kind: "exploration" | "file-edit" | "bash" | "spawn" | "tool",
	inProgress: boolean,
): ToolSummary {
	if (kind === "exploration") {
		return { label: inProgress ? "Exploring" : "Explored", details: [] };
	}
	if (kind === "file-edit") {
		return { label: inProgress ? "Editing" : "Edited", details: [] };
	}
	if (kind === "bash") {
		return {
			label: inProgress ? "Running command" : "Ran command",
			details: [],
		};
	}
	if (kind === "spawn") {
		return {
			label: inProgress ? "Spawning agent" : "Spawned agent",
			details: [],
		};
	}
	return { label: inProgress ? `Running ${toolName}` : toolName, details: [] };
}

function ToolMessageBlock({ message }: { message: ChatMessage }) {
	const [expanded, setExpanded] = useState(false);
	const payload = parseToolPayload(message.content);
	const toolName = message.meta?.toolName || payload?.toolName || "tool";
	const hookEventName = message.meta?.hookEventName;
	const inProgress =
		hookEventName === "tool_call_start" ||
		hookEventName === "history_tool_use" ||
		(Boolean(payload) && payload?.result == null && !payload?.isError);
	const kind = classifyTool(toolName);
	const Icon =
		kind === "exploration"
			? Search
			: kind === "file-edit"
				? FileEdit
				: kind === "bash"
					? Terminal
					: kind === "spawn"
						? Bot
						: FileSearch;
	const summary = payload
		? buildToolSummary(toolName, payload.input, payload.result, inProgress)
		: buildToolSummaryFromMeta(toolName, kind, inProgress);
	const details = summary.details;

	return (
		<div className="flex justify-start w-full">
			<div
				className={cn(
					"w-full rounded-xl py-1 text-xs",
					payload?.isError
						? "border border-destructive/40 bg-destructive/10 text-destructive"
						: "text-muted-foreground",
				)}
			>
				<Button
					className="w-full justify-start gap-2 p-0 text-left font-medium text-foreground/80 hover:bg-transparent"
					onClick={() => setExpanded((current) => !current)}
					type="button"
					variant="ghost"
				>
					<Icon className="h-3.5 w-3.5" />
					<span>{summary.label}</span>
					{details.length > 0 ? (
						<span className="ml-1 text-muted-foreground">
							{expanded ? (
								<ChevronDown className="h-3.5 w-3.5" />
							) : (
								<ChevronRight className="h-3.5 w-3.5" />
							)}
						</span>
					) : null}
				</Button>
				{expanded && details.length > 0 ? (
					<div className="space-y-1 pl-6 text-muted-foreground">
						{details.map((detail, index) => (
							<div className="text-sm" key={`${message.id}_${index}`}>
								{detail}
							</div>
						))}
					</div>
				) : null}
			</div>
		</div>
	);
}
