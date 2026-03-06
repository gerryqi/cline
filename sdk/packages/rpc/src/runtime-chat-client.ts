import { RpcSessionClient } from "./client.js";

export type RpcRuntimeEvent = {
	sessionId: string;
	eventType: string;
	payloadJson: string;
};

export type RpcRuntimeStreamStop = () => void;

export class RpcRuntimeChatClient {
	private client: RpcSessionClient;

	constructor(address = RpcRuntimeChatClient.resolveAddress()) {
		this.client = new RpcSessionClient({ address });
	}

	static resolveAddress(): string {
		return process.env.CLINE_RPC_ADDRESS?.trim() || "127.0.0.1:4317";
	}

	async startSession(config: unknown): Promise<string> {
		const response = await this.client.startRuntimeSession(
			JSON.stringify(config),
		);
		const sessionId = response.sessionId?.trim();
		if (!sessionId) {
			throw new Error("runtime start returned an empty session id");
		}
		return sessionId;
	}

	async sendSession(sessionId: string, request: unknown): Promise<string> {
		const response = await this.client.sendRuntimeSession(
			sessionId,
			JSON.stringify(request),
		);
		const resultRaw = response.resultJson?.trim();
		if (!resultRaw) {
			throw new Error("runtime send returned an empty result payload");
		}
		return resultRaw;
	}

	async abortSession(sessionId: string): Promise<boolean> {
		const response = await this.client.abortRuntimeSession(sessionId);
		return response.applied;
	}

	streamEvents(
		clientId: string,
		sessionIds: string[],
		handlers: {
			onEvent: (event: RpcRuntimeEvent) => void;
			onError: (error: Error) => void;
		},
	): RpcRuntimeStreamStop {
		return this.client.streamEvents(
			{
				clientId,
				sessionIds,
			},
			{
				onEvent: handlers.onEvent,
				onError: handlers.onError,
			},
		);
	}

	close(): void {
		this.client.close();
	}
}
