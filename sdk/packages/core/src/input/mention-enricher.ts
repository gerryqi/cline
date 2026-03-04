import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
	type FastFileIndexOptions,
	formatFileContentBlock,
	getFileIndex,
} from "@cline/shared";

const DEFAULT_MAX_FILES = 6;
const DEFAULT_MAX_FILE_BYTES = 60_000;
const DEFAULT_MAX_TOTAL_BYTES = 200_000;

const TRAILING_PUNCTUATION = /[),.:;!?`'"]+$/;
const LEADING_WRAPPERS = /^[(`'"]+/;

export interface MentionEnricherOptions extends FastFileIndexOptions {
	maxFiles?: number;
	maxFileBytes?: number;
	maxTotalBytes?: number;
}

export interface MentionEnrichmentResult {
	prompt: string;
	matchedFiles: string[];
	ignoredMentions: string[];
}

function extractMentionTokens(input: string): string[] {
	const matches = input.matchAll(/(^|[\s])@([^\s]+)/g);
	const mentions: string[] = [];
	for (const match of matches) {
		const token = (match[2] ?? "").trim();
		if (token.length === 0) {
			continue;
		}
		const normalized = token
			.replace(LEADING_WRAPPERS, "")
			.replace(TRAILING_PUNCTUATION, "");
		if (normalized.length === 0 || normalized.includes("@")) {
			continue;
		}
		mentions.push(normalized);
	}
	return Array.from(new Set(mentions));
}

function normalizeMentionPath(
	mention: string,
	cwd: string,
): string | undefined {
	const candidate = mention.replace(/\\/g, "/");
	const maybeAbsolute = path.isAbsolute(candidate)
		? path.resolve(candidate)
		: path.resolve(cwd, candidate);
	const relative = path.relative(cwd, maybeAbsolute);
	if (relative.startsWith("..") || path.isAbsolute(relative)) {
		return undefined;
	}
	return relative.split(path.sep).join("/");
}

async function readTextFileSafe(
	filePath: string,
	maxBytes: number,
): Promise<string | undefined> {
	const fileStat = await stat(filePath);
	if (!fileStat.isFile()) {
		return undefined;
	}
	if (fileStat.size > maxBytes) {
		return undefined;
	}
	const content = await readFile(filePath, "utf8");
	if (content.includes("\u0000")) {
		return undefined;
	}
	return content;
}

function buildAttachmentBlock(
	entries: Array<{ path: string; content: string }>,
): string {
	return entries
		.map((entry) => formatFileContentBlock(entry.path, entry.content))
		.join("\n\n");
}

export async function enrichPromptWithMentions(
	input: string,
	cwd: string,
	options: MentionEnricherOptions = {},
): Promise<MentionEnrichmentResult> {
	const mentions = extractMentionTokens(input);
	if (mentions.length === 0) {
		return {
			prompt: input,
			matchedFiles: [],
			ignoredMentions: [],
		};
	}

	const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
	const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
	const maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
	const fileList = await getFileIndex(cwd, { ttlMs: options.ttlMs });
	const matched: string[] = [];
	const ignored: string[] = [];
	const attachments: Array<{ path: string; content: string }> = [];
	let totalBytes = 0;

	for (const mention of mentions) {
		if (attachments.length >= maxFiles) {
			ignored.push(mention);
			continue;
		}

		const relativePath = normalizeMentionPath(mention, cwd);
		if (!relativePath || !fileList.has(relativePath)) {
			ignored.push(mention);
			continue;
		}

		const absolutePath = path.join(cwd, relativePath);
		try {
			const content = await readTextFileSafe(absolutePath, maxFileBytes);
			if (content === undefined) {
				ignored.push(mention);
				continue;
			}

			const nextBytes = totalBytes + Buffer.byteLength(content, "utf8");
			if (nextBytes > maxTotalBytes) {
				ignored.push(mention);
				continue;
			}

			totalBytes = nextBytes;
			matched.push(relativePath);
			attachments.push({
				path: relativePath,
				content,
			});
		} catch {
			ignored.push(mention);
		}
	}

	if (attachments.length === 0) {
		return {
			prompt: input,
			matchedFiles: matched,
			ignoredMentions: ignored,
		};
	}

	return {
		prompt: `${input}\n\n${buildAttachmentBlock(attachments)}`,
		matchedFiles: matched,
		ignoredMentions: ignored,
	};
}
