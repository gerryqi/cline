"use client";

import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type {
	DesktopTransportEvent,
	DesktopTransportMessage,
	DesktopTransportRequest,
	DesktopTransportResponse,
	DesktopTransportState,
} from "@/lib/desktop-transport";

type PendingRequest = {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timeoutId: ReturnType<typeof setTimeout>;
};

type EventHandler = (payload: unknown) => void;
type TransportStateHandler = (state: DesktopTransportState) => void;

const REQUEST_TIMEOUT_MS = 120_000;
const RECONNECT_BASE_DELAY_MS = 400;
const RECONNECT_MAX_DELAY_MS = 4_000;
const NATIVE_COMMANDS = new Set([
	"pick_workspace_directory",
	"open_mcp_settings_file",
]);

class DesktopClient {
	private socket: WebSocket | null = null;
	private connectPromise: Promise<void> | null = null;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private requestCounter = 0;
	private pending = new Map<string, PendingRequest>();
	private handlers = new Map<string, Set<EventHandler>>();
	private transportStateHandlers = new Set<TransportStateHandler>();
	private transportState: DesktopTransportState = "connecting";
	private hasConnectedOnce = false;
	private endpoint: string | null = null;

	private setTransportState(next: DesktopTransportState) {
		this.transportState = next;
		for (const handler of this.transportStateHandlers) {
			handler(next);
		}
	}

	private async getBackendEndpoint(): Promise<string> {
		if (this.endpoint?.trim()) {
			return this.endpoint;
		}
		const endpoint = await tauriInvoke<string>("get_desktop_backend_endpoint");
		this.endpoint = endpoint.trim();
		return this.endpoint;
	}

	private rejectPending(errorMessage: string) {
		for (const [requestId, pending] of this.pending.entries()) {
			clearTimeout(pending.timeoutId);
			this.pending.delete(requestId);
			pending.reject(new Error(errorMessage));
		}
	}

	private dispatchEvent(message: DesktopTransportEvent) {
		const handlers = this.handlers.get(message.event.name);
		if (!handlers || handlers.size === 0) {
			return;
		}
		for (const handler of handlers) {
			handler(message.event.payload);
		}
	}

	private handleMessage(raw: string) {
		let parsed: DesktopTransportMessage;
		try {
			parsed = JSON.parse(raw) as DesktopTransportMessage;
		} catch {
			return;
		}

		if (parsed.type === "event") {
			this.dispatchEvent(parsed);
			return;
		}

		const response = parsed as DesktopTransportResponse;
		const pending = this.pending.get(response.id);
		if (!pending) {
			return;
		}
		clearTimeout(pending.timeoutId);
		this.pending.delete(response.id);
		if (!response.ok) {
			pending.reject(new Error(response.error || "Desktop command failed"));
			return;
		}
		pending.resolve(response.result);
	}

	private scheduleReconnect() {
		if (this.reconnectTimer) {
			clearTimeout(this.reconnectTimer);
		}
		const attempt = Math.max(this.pending.size, 1);
		const delayMs = Math.min(
			RECONNECT_BASE_DELAY_MS * 2 ** Math.min(attempt, 4),
			RECONNECT_MAX_DELAY_MS,
		);
		this.reconnectTimer = setTimeout(() => {
			void this.ensureConnected(true);
		}, delayMs);
	}

	private async ensureConnected(isReconnect = false): Promise<void> {
		if (
			this.socket &&
			(this.socket.readyState === WebSocket.OPEN ||
				this.socket.readyState === WebSocket.CONNECTING)
		) {
			return;
		}
		if (this.connectPromise) {
			return this.connectPromise;
		}

		this.setTransportState(
			this.hasConnectedOnce || isReconnect ? "reconnecting" : "connecting",
		);

		this.connectPromise = (async () => {
			const endpoint = await this.getBackendEndpoint();
			await new Promise<void>((resolve, reject) => {
				const socket = new WebSocket(endpoint);
				this.socket = socket;
				socket.onopen = () => {
					this.hasConnectedOnce = true;
					this.setTransportState("connected");
					resolve();
				};
				socket.onmessage = (event) => {
					this.handleMessage(String(event.data));
				};
				socket.onerror = () => {
					// Wait for onclose to reject or reconnect.
				};
				socket.onclose = () => {
					if (this.socket === socket) {
						this.socket = null;
					}
					if (this.transportState !== "connected") {
						reject(new Error("Desktop backend transport unavailable"));
						return;
					}
					this.setTransportState("reconnecting");
					this.rejectPending("Desktop backend transport closed");
					this.scheduleReconnect();
				};
			});
		})().finally(() => {
			this.connectPromise = null;
		});

		return this.connectPromise;
	}

	async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
		if (NATIVE_COMMANDS.has(command)) {
			return await tauriInvoke<T>(command, args);
		}

		await this.ensureConnected();
		const socket = this.socket;
		if (!socket || socket.readyState !== WebSocket.OPEN) {
			throw new Error("Desktop backend transport unavailable");
		}

		const id = `desktop_${Date.now()}_${this.requestCounter++}`;
		const request: DesktopTransportRequest = {
			type: "command",
			id,
			command,
			args,
		};

		return await new Promise<T>((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				const pending = this.pending.get(id);
				if (!pending) {
					return;
				}
				this.pending.delete(id);
				pending.reject(
					new Error(`Desktop command timed out waiting for ${command}`),
				);
			}, REQUEST_TIMEOUT_MS);
			this.pending.set(id, {
				resolve: (value) => resolve(value as T),
				reject,
				timeoutId,
			});
			socket.send(JSON.stringify(request));
		});
	}

	subscribe(eventName: string, handler: EventHandler): () => void {
		void this.ensureConnected(true).catch(() => {
			// Keep UI functional enough to surface later retries.
		});
		const handlers = this.handlers.get(eventName) ?? new Set<EventHandler>();
		handlers.add(handler);
		this.handlers.set(eventName, handlers);
		return () => {
			const current = this.handlers.get(eventName);
			if (!current) {
				return;
			}
			current.delete(handler);
			if (current.size === 0) {
				this.handlers.delete(eventName);
			}
		};
	}

	subscribeTransportState(handler: TransportStateHandler): () => void {
		this.transportStateHandlers.add(handler);
		handler(this.transportState);
		void this.ensureConnected(true).catch(() => {
			// Ignore eager connect failures; commands will surface them.
		});
		return () => {
			this.transportStateHandlers.delete(handler);
		};
	}

	getTransportState(): DesktopTransportState {
		return this.transportState;
	}
}

export const desktopClient = new DesktopClient();
