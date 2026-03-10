import type { providers } from "@cline/llms";

function createConversationId(): string {
	return `conv_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export class ConversationStore {
	private messages: providers.Message[] = [];
	private conversationId = createConversationId();
	private sessionStarted = false;

	constructor(initialMessages?: providers.Message[]) {
		if ((initialMessages?.length ?? 0) > 0) {
			this.restore(initialMessages ?? []);
		}
	}

	getConversationId(): string {
		return this.conversationId;
	}

	getMessages(): providers.Message[] {
		return [...this.messages];
	}

	appendMessage(message: providers.Message): void {
		this.messages.push(message);
	}

	appendMessages(messages: providers.Message[]): void {
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

	restore(messages: providers.Message[]): void {
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
