import { z } from "zod";

export const ConnectorHookEventNameSchema = z.enum([
	"connector.started",
	"connector.stopping",
	"message.received",
	"message.completed",
	"message.failed",
	"session.started",
	"session.reused",
	"thread.reset",
	"schedule.delivery.started",
	"schedule.delivery.sent",
	"schedule.delivery.failed",
]);

export type ConnectorHookEventName = z.infer<
	typeof ConnectorHookEventNameSchema
>;

export const ConnectorHookEventSchema = z.object({
	adapter: z.string(),
	botUserName: z.string().optional(),
	event: ConnectorHookEventNameSchema,
	payload: z.record(z.string(), z.unknown()),
	ts: z.string(),
});

export type ConnectorHookEvent = z.infer<typeof ConnectorHookEventSchema>;
