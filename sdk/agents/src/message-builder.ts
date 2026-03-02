import type {
	Message,
	TextContent,
	ToolResultContent,
} from "@cline/llms/providers";

const DEFAULT_MAX_TOOL_RESULT_CHARS = 50_000;
const TARGET_TOOL_NAMES = new Set([
	"read_file",
	"read_files",
	"bash",
	"run_commands",
]);
const READ_TOOL_NAMES = new Set(["read_file", "read_files"]);
const KEEP_CHARS_PER_SIDE = 50_000;
const OUTDATED_FILE_CONTENT = "[outdated - see the latest file content]";

interface ReadResultRecord {
	toolUseId: string;
	paths: string[];
}

/**
 * Builds an API-safe message copy without mutating original conversation history.
 */
export class MessageBuilder {
	constructor(
		private readonly maxToolResultChars = DEFAULT_MAX_TOOL_RESULT_CHARS,
		private readonly targetToolNames = TARGET_TOOL_NAMES,
	) {}

	buildForApi(messages: Message[]): Message[] {
		const toolNameById = this.buildToolNameMap(messages);
		const readPathsByToolUseId = this.buildReadPathsFromToolUseMap(
			messages,
			toolNameById,
		);
		const latestReadToolUseByPath = this.buildLatestReadToolUseByPath(
			messages,
			toolNameById,
			readPathsByToolUseId,
		);

		return messages.map((message) => {
			if (!Array.isArray(message.content)) {
				return message;
			}

			const content = message.content.map((block) => {
				if (block.type !== "tool_result") {
					return block;
				}

				const toolName = toolNameById.get(block.tool_use_id);
				let nextContent = block.content;

				if (this.isReadTool(toolName)) {
					const readRecord = this.getReadResultRecord(
						block,
						readPathsByToolUseId.get(block.tool_use_id),
					);
					if (readRecord) {
						const outdatedPaths = readRecord.paths.filter(
							(path) => latestReadToolUseByPath.get(path) !== block.tool_use_id,
						);
						if (outdatedPaths.length > 0) {
							nextContent = this.replaceOutdatedReadContent(
								nextContent,
								outdatedPaths,
							);
						}
					}
				}

				if (this.shouldTruncateTool(toolName)) {
					nextContent = this.truncateToolResultContent(nextContent);
				}

				if (nextContent === block.content) {
					return block;
				}

				return {
					...block,
					content: nextContent,
				};
			});

			return {
				...message,
				content,
			};
		});
	}

	private buildToolNameMap(messages: Message[]): Map<string, string> {
		const toolNameById = new Map<string, string>();

		for (const message of messages) {
			if (!Array.isArray(message.content)) {
				continue;
			}

			for (const block of message.content) {
				if (block.type !== "tool_use") {
					continue;
				}
				toolNameById.set(block.id, block.name.toLowerCase());
			}
		}

		return toolNameById;
	}

	private buildReadPathsFromToolUseMap(
		messages: Message[],
		toolNameById: Map<string, string>,
	): Map<string, string[]> {
		const readPathsByToolUseId = new Map<string, string[]>();

		for (const message of messages) {
			if (!Array.isArray(message.content)) {
				continue;
			}

			for (const block of message.content) {
				if (block.type !== "tool_use") {
					continue;
				}

				const toolName = toolNameById.get(block.id);
				if (!this.isReadTool(toolName)) {
					continue;
				}

				const paths = this.extractPathsFromReadToolInput(block.input);
				if (paths.length > 0) {
					readPathsByToolUseId.set(block.id, paths);
				}
			}
		}

		return readPathsByToolUseId;
	}

	private buildLatestReadToolUseByPath(
		messages: Message[],
		toolNameById: Map<string, string>,
		readPathsByToolUseId: Map<string, string[]>,
	): Map<string, string> {
		const latestReadToolUseByPath = new Map<string, string>();

		for (const message of messages) {
			if (!Array.isArray(message.content)) {
				continue;
			}

			for (const block of message.content) {
				if (block.type !== "tool_result") {
					continue;
				}
				const toolName = toolNameById.get(block.tool_use_id);
				if (!this.isReadTool(toolName)) {
					continue;
				}

				const readRecord = this.getReadResultRecord(
					block,
					readPathsByToolUseId.get(block.tool_use_id),
				);
				if (!readRecord) {
					continue;
				}

				for (const path of readRecord.paths) {
					latestReadToolUseByPath.set(path, readRecord.toolUseId);
				}
			}
		}

		return latestReadToolUseByPath;
	}

	private getReadResultRecord(
		block: ToolResultContent,
		fallbackPaths: string[] | undefined,
	): ReadResultRecord | undefined {
		const parsedPaths = this.extractReadPathsFromToolResultContent(
			block.content,
		);
		const paths = parsedPaths.length > 0 ? parsedPaths : (fallbackPaths ?? []);
		if (paths.length === 0) {
			return undefined;
		}

		return {
			toolUseId: block.tool_use_id,
			paths,
		};
	}

	private extractPathsFromReadToolInput(
		input: Record<string, unknown>,
	): string[] {
		const paths: string[] = [];
		const maybePath = input.path;
		const maybeFilePath = input.file_path;
		const maybeFilePaths = input.file_paths;

		if (typeof maybePath === "string" && maybePath.length > 0) {
			paths.push(maybePath);
		}
		if (typeof maybeFilePath === "string" && maybeFilePath.length > 0) {
			paths.push(maybeFilePath);
		}
		if (Array.isArray(maybeFilePaths)) {
			for (const value of maybeFilePaths) {
				if (typeof value === "string" && value.length > 0) {
					paths.push(value);
				}
			}
		}

		return Array.from(new Set(paths));
	}

	private extractReadPathsFromToolResultContent(
		content: ToolResultContent["content"],
	): string[] {
		if (typeof content !== "string") {
			return [];
		}

		try {
			const parsed = JSON.parse(content);
			return this.extractPathsFromParsedReadResult(parsed);
		} catch {
			return [];
		}
	}

	private extractPathsFromParsedReadResult(value: unknown): string[] {
		if (Array.isArray(value)) {
			const paths = value
				.map((item) => this.extractPathFromResultEntry(item))
				.filter(
					(path): path is string => typeof path === "string" && path.length > 0,
				);
			return Array.from(new Set(paths));
		}

		const path = this.extractPathFromResultEntry(value);
		return path ? [path] : [];
	}

	private extractPathFromResultEntry(value: unknown): string | undefined {
		if (!value || typeof value !== "object") {
			return undefined;
		}

		const record = value as Record<string, unknown>;
		const candidates = [
			record.path,
			record.file_path,
			record.filePath,
			record.query,
		];
		for (const candidate of candidates) {
			if (typeof candidate === "string" && candidate.length > 0) {
				return candidate;
			}
		}

		return undefined;
	}

	private replaceOutdatedReadContent(
		content: ToolResultContent["content"],
		outdatedPaths: string[],
	): ToolResultContent["content"] {
		const outdatedPathSet = new Set(outdatedPaths);

		if (typeof content === "string") {
			const replaced = this.replaceOutdatedReadContentInString(
				content,
				outdatedPathSet,
			);
			return replaced ?? OUTDATED_FILE_CONTENT;
		}

		return content.map((entry) => {
			if (entry.type !== "text") {
				return entry;
			}
			const replaced = this.replaceOutdatedReadContentInString(
				entry.text,
				outdatedPathSet,
			);
			if (replaced === null) {
				return {
					...(entry as TextContent),
					text: OUTDATED_FILE_CONTENT,
				};
			}
			if (replaced === entry.text) {
				return entry;
			}
			return {
				...(entry as TextContent),
				text: replaced,
			};
		});
	}

	private replaceOutdatedReadContentInString(
		text: string,
		outdatedPathSet: Set<string>,
	): string | null {
		try {
			const parsed = JSON.parse(text);
			const replaced = this.replaceOutdatedReadContentInParsed(
				parsed,
				outdatedPathSet,
			);
			return JSON.stringify(replaced);
		} catch {
			return null;
		}
	}

	private replaceOutdatedReadContentInParsed(
		value: unknown,
		outdatedPathSet: Set<string>,
	): unknown {
		if (Array.isArray(value)) {
			return value.map((entry) =>
				this.replaceOutdatedReadEntry(entry, outdatedPathSet),
			);
		}

		return this.replaceOutdatedReadEntry(value, outdatedPathSet);
	}

	private replaceOutdatedReadEntry(
		entry: unknown,
		outdatedPathSet: Set<string>,
	): unknown {
		if (!entry || typeof entry !== "object") {
			return entry;
		}

		const record = { ...(entry as Record<string, unknown>) };
		const path = this.extractPathFromResultEntry(record);
		if (!path || !outdatedPathSet.has(path)) {
			return entry;
		}

		if (typeof record.result === "string") {
			record.result = OUTDATED_FILE_CONTENT;
		} else if (typeof record.content === "string") {
			record.content = OUTDATED_FILE_CONTENT;
		} else {
			record.result = OUTDATED_FILE_CONTENT;
		}

		return record;
	}

	private isReadTool(toolName: string | undefined): boolean {
		if (!toolName) {
			return false;
		}
		return READ_TOOL_NAMES.has(toolName.toLowerCase());
	}

	private shouldTruncateTool(toolName: string | undefined): boolean {
		if (!toolName) {
			return false;
		}
		return this.targetToolNames.has(toolName.toLowerCase());
	}

	private truncateToolResultContent(
		content: ToolResultContent["content"],
	): ToolResultContent["content"] {
		if (typeof content === "string") {
			return this.truncateMiddle(content);
		}

		return content.map((entry) => {
			if (entry.type !== "text") {
				return entry;
			}

			const text = this.truncateMiddle(entry.text);
			if (text === entry.text) {
				return entry;
			}

			return {
				...(entry as TextContent),
				text,
			};
		});
	}

	private truncateMiddle(text: string): string {
		if (text.length <= this.maxToolResultChars) {
			return text;
		}

		const retainedChars = KEEP_CHARS_PER_SIDE * 2;
		const removedChars = Math.max(0, text.length - retainedChars);
		const marker = `\n\n...[truncated ${removedChars} chars]...\n\n`;

		const start = text.slice(0, KEEP_CHARS_PER_SIDE);
		const end = text.slice(-KEEP_CHARS_PER_SIDE);

		return `${start}${marker}${end}`;
	}
}
