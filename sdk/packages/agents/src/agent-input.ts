import type { providers } from "@cline/llms";
import { formatFileContentBlock } from "@cline/shared";

export async function buildInitialUserContent(
	userMessage: string,
	userImages?: string[],
	userFiles?: string[],
	userFileContentLoader?: (path: string) => Promise<string>,
): Promise<string | providers.ContentBlock[]> {
	const imageBlocks = buildImageBlocks(userImages);
	const fileTextBlock = await buildUserFileTextBlock(
		userFiles,
		userFileContentLoader,
	);

	if (imageBlocks.length === 0 && !fileTextBlock) {
		return userMessage;
	}

	const content: providers.ContentBlock[] = [
		{
			type: "text",
			text: userMessage,
		},
		...imageBlocks,
	];
	if (fileTextBlock) {
		content.push({
			type: "text",
			text: fileTextBlock,
		});
	}
	return content;
}

function buildImageBlocks(userImages?: string[]): providers.ImageContent[] {
	if (!userImages || userImages.length === 0) {
		return [];
	}

	const blocks: providers.ImageContent[] = [];
	for (const image of userImages) {
		const block = parseDataUrlImage(image);
		if (block) {
			blocks.push(block);
		}
	}
	return blocks;
}

function parseDataUrlImage(image: string): providers.ImageContent | undefined {
	const value = image.trim();
	if (!value) {
		return undefined;
	}

	const dataUrlMatch = value.match(/^data:([^;,]+);base64,(.+)$/);
	if (dataUrlMatch) {
		const mediaType = dataUrlMatch[1];
		const data = dataUrlMatch[2];
		if (!mediaType || !data) {
			return undefined;
		}
		return {
			type: "image",
			mediaType,
			data,
		};
	}

	// Fallback: treat as plain base64 payload.
	return {
		type: "image",
		mediaType: "image/png",
		data: value,
	};
}

async function buildUserFileTextBlock(
	userFiles?: string[],
	userFileContentLoader?: (path: string) => Promise<string>,
): Promise<string | undefined> {
	if (!userFiles || userFiles.length === 0) {
		return undefined;
	}

	const loader =
		userFileContentLoader ??
		(async () => {
			throw new Error(
				"File loading is not configured in this runtime. Provide userFileContentLoader to enable userFiles support.",
			);
		});

	const contents = await Promise.all(
		userFiles.map(async (filePath) => {
			const normalizedPath = filePath.replace(/\\/g, "/");
			try {
				const content = await loader(filePath);
				return formatFileContentBlock(normalizedPath, content);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return formatFileContentBlock(
					normalizedPath,
					`Error fetching content: ${message}`,
				);
			}
		}),
	);

	const combined = contents.filter((entry) => entry.length > 0).join("\n\n");
	if (!combined) {
		return undefined;
	}
	return `Files attached by the user:\n\n${combined}`;
}
