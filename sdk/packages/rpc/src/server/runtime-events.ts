import { randomUUID } from "node:crypto";
import type * as grpc from "@grpc/grpc-js";
import type { RoutedEvent } from "../types.js";
import { normalizeSessionIds, nowIso, safeString } from "./helpers.js";
import type {
	PublishEventRequest,
	PublishEventResponse,
	RoutedEventMessage,
	StreamEventsRequest,
} from "./proto-types.js";

interface StreamSubscriber {
	call: grpc.ServerWritableStream<StreamEventsRequest, RoutedEventMessage>;
	filterSessionIds: Set<string> | undefined;
}

export class RuntimeEventService {
	private readonly subscribers = new Map<number, StreamSubscriber>();
	private nextSubscriberId = 1;

	public publishEvent(request: PublishEventRequest): PublishEventResponse {
		const sessionId = safeString(request.sessionId).trim();
		if (!sessionId) {
			throw new Error("sessionId is required");
		}
		const event: RoutedEvent = {
			eventId: safeString(request.eventId).trim() || `evt_${randomUUID()}`,
			sessionId,
			taskId: safeString(request.taskId).trim() || undefined,
			eventType: safeString(request.eventType).trim() || "unknown",
			payloadJson: safeString(request.payloadJson),
			sourceClientId: safeString(request.sourceClientId).trim() || undefined,
			ts: nowIso(),
		};
		this.dispatchEvent(event);
		return { eventId: event.eventId, accepted: true };
	}

	public addSubscriber(
		call: grpc.ServerWritableStream<StreamEventsRequest, RoutedEventMessage>,
	): number {
		const request = call.request;
		const filterSessionIds = normalizeSessionIds(request.sessionIds);
		const subscriberId = this.nextSubscriberId;
		this.nextSubscriberId += 1;
		this.subscribers.set(subscriberId, { call, filterSessionIds });
		call.on("cancelled", () => {
			this.subscribers.delete(subscriberId);
		});
		call.on("close", () => {
			this.subscribers.delete(subscriberId);
		});
		return subscriberId;
	}

	public removeSubscriber(subscriberId: number): void {
		this.subscribers.delete(subscriberId);
	}

	public broadcastServerEvent(eventType: string, payload: unknown): void {
		const eventId = `evt_${randomUUID()}`;
		const payloadJson = JSON.stringify(payload);
		const ts = nowIso();
		for (const subscriber of this.subscribers.values()) {
			subscriber.call.write({
				eventId,
				sessionId: "__rpc__",
				taskId: "",
				eventType,
				payloadJson,
				sourceClientId: "rpc-server",
				ts,
			});
		}
	}

	private dispatchEvent(event: RoutedEvent): void {
		for (const subscriber of this.subscribers.values()) {
			if (
				subscriber.filterSessionIds &&
				!subscriber.filterSessionIds.has(event.sessionId)
			) {
				continue;
			}
			subscriber.call.write({
				eventId: event.eventId,
				sessionId: event.sessionId,
				taskId: event.taskId ?? "",
				eventType: event.eventType,
				payloadJson: event.payloadJson,
				sourceClientId: event.sourceClientId ?? "",
				ts: event.ts,
			});
		}
	}
}
