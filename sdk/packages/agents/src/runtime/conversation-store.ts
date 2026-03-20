import type { providers } from "@clinebot/llms";

function createConversationId(): string {
	return `conv_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export class ConversationStore {
	private messages: providers.MessageWithMetadata[] = [];
	private conversationId = createConversationId();
	private sessionStarted = false;

	constructor(initialMessages?: providers.MessageWithMetadata[]) {
		if ((initialMessages?.length ?? 0) > 0) {
			this.restore(initialMessages ?? []);
		}
	}

	getConversationId(): string {
		return this.conversationId;
	}

	getMessages(): providers.MessageWithMetadata[] {
		return [...this.messages];
	}

	appendMessage(message: providers.MessageWithMetadata): void {
		this.messages.push(message);
	}

	appendMessages(messages: providers.MessageWithMetadata[]): void {
		if (messages.length === 0) {
			return;
		}
		this.messages.push(...messages);
	}

	resetForRun(): void {
		this.messages = [];
		this.conversationId = createConversationId();
		this.sessionStarted = false;
	}

	clearHistory(): void {
		this.messages = [];
		this.conversationId = createConversationId();
		this.sessionStarted = false;
	}

	restore(messages: providers.MessageWithMetadata[]): void {
		this.messages = [...messages];
		this.sessionStarted = false;
	}

	isSessionStarted(): boolean {
		return this.sessionStarted;
	}

	markSessionStarted(): void {
		this.sessionStarted = true;
	}
}
