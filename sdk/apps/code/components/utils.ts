export function normalizeTitle(title?: string): string {
	if (!title?.trim()) return "";
	return title.replace(/<user_input>(.*?)<\/user_input>/g, "$1");
}
