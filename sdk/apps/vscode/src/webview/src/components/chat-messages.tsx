import { PlusIcon } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "./ui/button";

export type ChatMessageItem = {
	id: string;
	role: "user" | "assistant" | "meta" | "error";
	text: string;
};

export function ChatMessages({
	_messages,
	status,
	sessionId,
	sending,
	onReset,
}: {
	_messages: ChatMessageItem[];
	status: string;
	sessionId?: string;
	sending: boolean;
	onReset: () => void;
}) {
	const viewportRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const viewport = sending && _messages?.length ? viewportRef.current : null;
		if (viewport) {
			viewport.scrollTop = viewport.scrollHeight;
		}
	}, [_messages, sending]);

	const displayMessages = useMemo(() => _messages, [_messages]);
	const isNewSession = useMemo(() => !_messages?.length, [_messages]);

	return (
		<Card className="chat-stage min-h-0 overflow-hidden w-full">
			<CardHeader className="w-full flex items-center justify-between">
				<div className="flex items-center gap-4">
					<span>{status.includes("Failed") ? status : null}</span>
					<CardTitle className="text-xs">{sessionId}</CardTitle>
				</div>
				{isNewSession ? (
					<CardTitle className="text-3xl">Cline</CardTitle>
				) : (
					<Button variant="ghost" onClick={onReset}>
						<PlusIcon className="size-4" />
					</Button>
				)}
			</CardHeader>
			<Separator />
			<CardContent
				ref={viewportRef}
				className="chat-stage__messages overflow-auto"
			>
				{displayMessages.map((message) => (
					<Card
						key={message.id}
						size="sm"
						className={`message message--${message.role}`}
					>
						<CardContent>
							<pre className="message__body">{message.text}</pre>
						</CardContent>
					</Card>
				))}
				{sending ? (
					<div className="message message--meta flex items-center gap-2">
						<Spinner />
						<pre className="message__body">Thinking...</pre>
					</div>
				) : null}
			</CardContent>
		</Card>
	);
}
