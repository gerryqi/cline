import type { AgentEvent } from "@cline/agents";

type SessionManagerSubscriber = {
	subscribe(listener: (event: unknown) => void): () => void;
};

export function subscribeToAgentEvents(
	sessionManager: SessionManagerSubscriber,
	onAgentEvent: (event: AgentEvent) => void,
): () => void {
	let hasSeenStructuredAgentEvent = false;
	return sessionManager.subscribe((event: unknown) => {
		const typedEvent = event as
			| { type: "agent_event"; payload: { event: AgentEvent } }
			| { type: "chunk"; payload: { stream: string; chunk: string } }
			| { type: string; payload?: unknown };
		if (typedEvent.type === "agent_event") {
			hasSeenStructuredAgentEvent = true;
			const payload = typedEvent.payload as { event?: AgentEvent } | undefined;
			if (payload?.event) {
				onAgentEvent(payload.event);
			}
			return;
		}

		const chunkEvent = event as
			| { type: "chunk"; payload: { stream: string; chunk: string } }
			| { type: string; payload?: unknown };
		if (
			chunkEvent.type !== "chunk" ||
			!chunkEvent.payload ||
			typeof chunkEvent.payload !== "object"
		) {
			return;
		}
		if (hasSeenStructuredAgentEvent) {
			return;
		}
		const payload = chunkEvent.payload as { stream?: string; chunk?: string };
		if (payload.stream !== "agent" || typeof payload.chunk !== "string") {
			return;
		}
		try {
			onAgentEvent(JSON.parse(payload.chunk) as AgentEvent);
		} catch {
			// Best-effort event parsing path.
		}
	});
}
