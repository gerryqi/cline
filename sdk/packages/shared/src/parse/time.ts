/**
 * Parses a date string and returns a human-readable format.
 * If the input is invalid, it returns the original string or a placeholder.
 *
 * @param dateStr - The date string to parse.
 * @returns A human-readable date string or the original input if invalid.
 */
export function formatHumanReadableDate(dateStr?: string): string {
	if (!dateStr) return "(unknown-date)";
	const date = new Date(dateStr);
	if (Number.isNaN(date.getTime())) return dateStr;
	return date.toLocaleString("en-US", {
		year: "numeric",
		month: "numeric",
		day: "numeric",
		hour: "numeric",
		minute: "numeric",
		second: "numeric",
		hour12: true,
	});
}
