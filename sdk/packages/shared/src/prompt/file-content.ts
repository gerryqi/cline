export function formatFileContentBlock(path: string, content: string): string {
	return `<file_content path="${path}">\n${content}\n</file_content>`;
}
