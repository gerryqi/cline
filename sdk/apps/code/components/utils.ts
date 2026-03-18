import { normalizeUserInput } from "@clinebot/shared";

export function normalizeTitle(title?: string): string {
	return normalizeUserInput(title);
}
