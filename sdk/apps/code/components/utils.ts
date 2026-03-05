import { normalizeUserInput } from "@cline/shared";

export function normalizeTitle(title?: string): string {
	return normalizeUserInput(title);
}
