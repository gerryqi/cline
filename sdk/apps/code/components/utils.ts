import { normalizeUserInput } from "@clinebot/core";

export function normalizeTitle(title?: string): string {
	return normalizeUserInput(title);
}
