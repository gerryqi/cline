export function normalizeTitle(title?: string): string {
	if (!title?.trim()) return "";
	// Strip <user_input ...>...</user_input> wrapper tags if present
	return title.replace(/<user_input.*?>(.*?)<\/user_input>/g, "$1");
}
