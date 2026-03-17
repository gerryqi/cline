import { telegramConnector } from "./telegram";
import type { ConnectCommandDefinition } from "./types";

const registry = new Map<string, ConnectCommandDefinition>([
	[telegramConnector.name, telegramConnector],
]);

export function listConnectors(): ConnectCommandDefinition[] {
	return [...registry.values()];
}

export function getConnector(
	name: string,
): ConnectCommandDefinition | undefined {
	return registry.get(name.trim().toLowerCase());
}
