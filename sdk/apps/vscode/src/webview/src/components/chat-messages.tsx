import { useEffect, useMemo, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";

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
}: {
	_messages: ChatMessageItem[];
	status: string;
	sessionId?: string;
	sending: boolean;
}) {
	const viewportRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const viewport = sending && _messages?.length ? viewportRef.current : null;
		if (viewport) {
			viewport.scrollTop = viewport.scrollHeight;
		}
	}, [_messages, sending]);

	const displayMessages = useMemo(() => _messages, [_messages]);

	return (
		<Card className="chat-stage min-h-0 overflow-hidden rounded-2xl">
			<CardHeader className="chat-stage__header">
				<CardTitle className="text-3xl">Cline</CardTitle>
				<div className="chat-stage__status">
					<span>{status}</span>
					{sessionId ? <code>{sessionId}</code> : null}
				</div>
			</CardHeader>
			<Separator />
			<CardContent
				ref={viewportRef}
				className="chat-stage__messages overflow-auto"
			>
				{displayMessages.length === 0 ? (
					<div className="message message--meta">
						Pick a provider & model before sending a prompt.
					</div>
				) : null}
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
