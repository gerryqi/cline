export interface RpcServerOptions {
	address?: string;
}

export interface RpcServerHandle {
	serverId: string;
	address: string;
	port: number;
	startedAt: string;
	stop: () => Promise<void>;
}

export interface RoutedEvent {
	eventId: string;
	sessionId: string;
	taskId?: string;
	eventType: string;
	payloadJson: string;
	sourceClientId?: string;
	ts: string;
}

export interface PendingApproval {
	approvalId: string;
	sessionId: string;
	taskId?: string;
	toolCallId: string;
	toolName: string;
	inputJson: string;
	requesterClientId?: string;
	createdAt: string;
}
