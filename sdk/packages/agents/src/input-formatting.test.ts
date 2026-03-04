import { formatFileContentBlock } from "@cline/shared";
import { describe, expect, it } from "vitest";

describe("formatFileContentBlock", () => {
	it("renders a file_content block", () => {
		expect(formatFileContentBlock("src/index.ts", "const x = 1\n")).toBe(
			'<file_content path="src/index.ts">\nconst x = 1\n\n</file_content>',
		);
	});
});
