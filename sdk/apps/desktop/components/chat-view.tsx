"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ChatMessages } from "@/components/chat-messages";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { UserNav } from "@/components/user-nav";
import { DEFAULT_CHAT_CONFIG, useChatSession } from "@/hooks/use-chat-session";
import { cn } from "@/lib/utils";

export function ChatView() {
	const {
		sessionId,
		status,
		config,
		messages,
		error,
		summary,
		setConfig,
		sendPrompt,
		reset,
	} = useChatSession();
	const [promptInput, setPromptInput] = useState("");

	const running = status === "running";
	const starting = status === "starting";
	const stopping = status === "stopping";

	async function handleSend() {
		const value = promptInput.trim();
		if (!value) {
			return;
		}
		setPromptInput("");
		await sendPrompt(value);
	}

	return (
		<div className="flex min-h-[100dvh] flex-col">
			<header className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-6">
				<div className="flex items-center gap-3">
					<Link
						aria-label="Back to home"
						className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground sm:h-9 sm:w-9"
						href="/"
					>
						<ChevronLeft className="h-4 w-4" />
					</Link>
					<div>
						<h1 className="text-base font-semibold text-foreground sm:text-lg">
							Chat
						</h1>
						<p className="text-[10px] text-muted-foreground sm:text-xs">
							Desktop-native agent runtime powered by agents + llms
						</p>
					</div>
				</div>
				<div className="flex items-center gap-3">
					<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
						<span
							className={cn(
								"inline-flex h-2 w-2 rounded-full",
								running
									? "animate-pulse-dot bg-success"
									: "bg-muted-foreground",
							)}
						/>
						<span>{status}</span>
					</div>
					{sessionId && (
						<span className="hidden rounded-md border border-border bg-background px-2 py-1 font-mono text-[10px] text-muted-foreground sm:inline-block">
							{sessionId}
						</span>
					)}
					<UserNav size="sm" />
				</div>
			</header>

			<main className="grid flex-1 gap-4 p-4 md:grid-cols-[340px_1fr] sm:p-6">
				<section className="rounded-xl border border-border bg-card p-4">
					<h2 className="text-sm font-semibold text-foreground">
						Session Config
					</h2>
					<div className="mt-3 space-y-3">
						<div className="space-y-1">
							<Label className="text-xs">Workspace Root</Label>
							<Input
								disabled={running || starting || stopping}
								onChange={(event) =>
									setConfig((prev) => ({
										...prev,
										workspaceRoot: event.target.value,
									}))
								}
								value={config.workspaceRoot}
							/>
						</div>
						<div className="grid grid-cols-2 gap-2">
							<div className="space-y-1">
								<Label className="text-xs">Provider</Label>
								<Input
									disabled={running || starting || stopping}
									onChange={(event) =>
										setConfig((prev) => ({
											...prev,
											provider: event.target.value,
										}))
									}
									value={config.provider}
								/>
							</div>
							<div className="space-y-1">
								<Label className="text-xs">Model</Label>
								<Input
									disabled={running || starting || stopping}
									onChange={(event) =>
										setConfig((prev) => ({
											...prev,
											model: event.target.value,
										}))
									}
									value={config.model}
								/>
							</div>
						</div>
						<div className="space-y-1">
							<Label className="text-xs">API Key</Label>
							<Input
								disabled={running || starting || stopping}
								onChange={(event) =>
									setConfig((prev) => ({ ...prev, apiKey: event.target.value }))
								}
								type="password"
								value={config.apiKey}
							/>
						</div>
						<div className="space-y-1">
							<Label className="text-xs">System Prompt</Label>
							<Textarea
								disabled={running || starting || stopping}
								onChange={(event) =>
									setConfig((prev) => ({
										...prev,
										systemPrompt: event.target.value,
									}))
								}
								rows={4}
								value={config.systemPrompt ?? ""}
							/>
						</div>
						<div className="rounded-lg border border-border bg-background p-2 text-xs text-muted-foreground">
							<div>Tool calls: {summary.toolCalls}</div>
							<div>Input tokens: {summary.tokensIn}</div>
							<div>Output tokens: {summary.tokensOut}</div>
						</div>
						<Button
							className="w-full"
							disabled={running || starting || stopping}
							onClick={reset}
							size="sm"
						>
							New Chat
						</Button>
						<Button
							className="w-full"
							disabled={running || starting || stopping}
							onClick={() => setConfig(DEFAULT_CHAT_CONFIG)}
							size="sm"
							variant="outline"
						>
							Restore Defaults
						</Button>
					</div>
				</section>

				<ChatMessages
					error={error}
					messages={messages}
					model={config.model}
					onPromptInputChange={setPromptInput}
					onSend={() => void handleSend()}
					promptInput={promptInput}
					provider={config.provider}
					sessionId={sessionId}
					status={status}
				/>
			</main>
		</div>
	);
}
