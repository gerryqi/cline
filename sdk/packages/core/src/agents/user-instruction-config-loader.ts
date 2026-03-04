import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import YAML from "yaml";
import { resolveClineDataDir } from "../storage/paths";
import {
	type UnifiedConfigDefinition,
	type UnifiedConfigFileCandidate,
	UnifiedConfigFileWatcher,
	type UnifiedConfigWatcherEvent,
} from "./unified-config-file-watcher";

const SKILL_FILE_NAME = "SKILL.md";

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".txt"]);

export const SKILLS_CONFIG_DIRECTORY_NAME = "skills";
export const RULES_CONFIG_DIRECTORY_NAME = "rules";
export const WORKFLOWS_CONFIG_DIRECTORY_NAME = "workflows";

export const DOCUMENTS_RULES_DIRECTORY_PATH = join(
	homedir(),
	"Documents",
	"Cline",
	"Rules",
);
export const DOCUMENTS_WORKFLOWS_DIRECTORY_PATH = join(
	homedir(),
	"Documents",
	"Cline",
	"Workflows",
);

export interface ParseMarkdownFrontmatterResult {
	data: Record<string, unknown>;
	body: string;
	hadFrontmatter: boolean;
	parseError?: string;
}

export interface SkillConfig {
	name: string;
	description?: string;
	disabled?: boolean;
	instructions: string;
	frontmatter: Record<string, unknown>;
}

export interface RuleConfig {
	name: string;
	disabled?: boolean;
	instructions: string;
	frontmatter: Record<string, unknown>;
}

export interface WorkflowConfig {
	name: string;
	disabled?: boolean;
	instructions: string;
	frontmatter: Record<string, unknown>;
}

export type UserInstructionConfigType = "skill" | "rule" | "workflow";

export type UserInstructionConfig = SkillConfig | RuleConfig | WorkflowConfig;

export type UserInstructionConfigWatcher = UnifiedConfigFileWatcher<
	UserInstructionConfigType,
	UserInstructionConfig
>;

export type UserInstructionConfigWatcherEvent = UnifiedConfigWatcherEvent<
	UserInstructionConfigType,
	UserInstructionConfig
>;

export interface CreateInstructionWatcherOptions {
	debounceMs?: number;
	emitParseErrors?: boolean;
}

export interface CreateSkillsConfigDefinitionOptions {
	directories?: ReadonlyArray<string>;
	workspacePath?: string;
}

export interface CreateRulesConfigDefinitionOptions {
	directories?: ReadonlyArray<string>;
	workspacePath?: string;
}

export interface CreateWorkflowsConfigDefinitionOptions {
	directories?: ReadonlyArray<string>;
	workspacePath?: string;
}

function normalizeName(name: string): string {
	return name.trim().toLowerCase();
}

function isMarkdownFile(fileName: string): boolean {
	return MARKDOWN_EXTENSIONS.has(extname(fileName).toLowerCase());
}

function parseMarkdownFrontmatter(
	content: string,
): ParseMarkdownFrontmatterResult {
	const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
	const match = content.match(frontmatterRegex);
	if (!match) {
		return { data: {}, body: content, hadFrontmatter: false };
	}

	const [, yamlContent, body] = match;
	try {
		const parsed = YAML.parse(yamlContent);
		const data =
			parsed && typeof parsed === "object" && !Array.isArray(parsed)
				? (parsed as Record<string, unknown>)
				: {};
		return { data, body, hadFrontmatter: true };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			data: {},
			body: content,
			hadFrontmatter: true,
			parseError: message,
		};
	}
}

function parseStringField(
	value: unknown,
	fieldName: string,
	isRequired: boolean,
): string | undefined {
	if (value === undefined || value === null) {
		if (isRequired) {
			throw new Error(`Missing required frontmatter field '${fieldName}'.`);
		}
		return undefined;
	}
	if (typeof value !== "string") {
		throw new Error(`Frontmatter field '${fieldName}' must be a string.`);
	}
	const normalized = value.trim();
	if (!normalized && isRequired) {
		throw new Error(`Frontmatter field '${fieldName}' cannot be empty.`);
	}
	return normalized || undefined;
}

function parseBooleanField(
	value: unknown,
	fieldName: string,
): boolean | undefined {
	if (value === undefined || value === null) {
		return undefined;
	}
	if (typeof value !== "boolean") {
		throw new Error(`Frontmatter field '${fieldName}' must be a boolean.`);
	}
	return value;
}

export function parseSkillConfigFromMarkdown(
	content: string,
	fallbackName: string,
): SkillConfig {
	const { data, body, parseError } = parseMarkdownFrontmatter(content);
	if (parseError) {
		throw new Error(`Failed to parse YAML frontmatter: ${parseError}`);
	}
	const instructions = body.trim();
	if (!instructions) {
		throw new Error("Missing instructions body in skill file.");
	}
	const parsedName = parseStringField(data.name, "name", false);
	const name = parsedName ?? fallbackName.trim();
	if (!name) {
		throw new Error("Missing skill name.");
	}

	return {
		name,
		description: parseStringField(data.description, "description", false),
		disabled:
			parseBooleanField(data.disabled, "disabled") ??
			(parseBooleanField(data.enabled, "enabled") === false ? true : undefined),
		instructions,
		frontmatter: data,
	};
}

export function parseRuleConfigFromMarkdown(
	content: string,
	fallbackName: string,
): RuleConfig {
	const { data, body, parseError } = parseMarkdownFrontmatter(content);
	if (parseError) {
		throw new Error(`Failed to parse YAML frontmatter: ${parseError}`);
	}
	const instructions = body.trim();
	if (!instructions) {
		throw new Error("Missing instructions body in rule file.");
	}
	const name =
		parseStringField(data.name, "name", false) ?? fallbackName.trim();
	if (!name) {
		throw new Error("Missing rule name.");
	}
	return {
		name,
		disabled:
			parseBooleanField(data.disabled, "disabled") ??
			(parseBooleanField(data.enabled, "enabled") === false ? true : undefined),
		instructions,
		frontmatter: data,
	};
}

export function parseWorkflowConfigFromMarkdown(
	content: string,
	fallbackName: string,
): WorkflowConfig {
	const { data, body, parseError } = parseMarkdownFrontmatter(content);
	if (parseError) {
		throw new Error(`Failed to parse YAML frontmatter: ${parseError}`);
	}
	const instructions = body.trim();
	if (!instructions) {
		throw new Error("Missing instructions body in workflow file.");
	}
	const name =
		parseStringField(data.name, "name", false) ?? fallbackName.trim();
	if (!name) {
		throw new Error("Missing workflow name.");
	}
	return {
		name,
		disabled:
			parseBooleanField(data.disabled, "disabled") ??
			(parseBooleanField(data.enabled, "enabled") === false ? true : undefined),
		instructions,
		frontmatter: data,
	};
}

function getWorkspaceSkillDirectories(workspacePath?: string): string[] {
	if (!workspacePath) {
		return [];
	}
	return [
		join(workspacePath, ".clinerules", "skills"),
		join(workspacePath, ".cline", "skills"),
		join(workspacePath, ".claude", "skills"),
		join(workspacePath, ".agents", "skills"),
	];
}

function dedupePaths(paths: ReadonlyArray<string>): string[] {
	const seen = new Set<string>();
	const deduped: string[] = [];
	for (const candidate of paths) {
		if (!candidate || seen.has(candidate)) {
			continue;
		}
		seen.add(candidate);
		deduped.push(candidate);
	}
	return deduped;
}

export function resolveSkillsConfigSearchPaths(
	workspacePath?: string,
): string[] {
	return dedupePaths([
		...getWorkspaceSkillDirectories(workspacePath),
		join(resolveClineDataDir(), "settings", SKILLS_CONFIG_DIRECTORY_NAME),
		join(homedir(), ".cline", "skills"),
		join(homedir(), ".agents", "skills"),
	]);
}

export function resolveRulesConfigSearchPaths(
	workspacePath?: string,
): string[] {
	return dedupePaths([
		workspacePath ? join(workspacePath, ".clinerules") : "",
		join(resolveClineDataDir(), "settings", RULES_CONFIG_DIRECTORY_NAME),
		DOCUMENTS_RULES_DIRECTORY_PATH,
	]);
}

export function resolveWorkflowsConfigSearchPaths(
	workspacePath?: string,
): string[] {
	return dedupePaths([
		workspacePath ? join(workspacePath, ".clinerules", "workflows") : "",
		join(resolveClineDataDir(), "settings", WORKFLOWS_CONFIG_DIRECTORY_NAME),
		DOCUMENTS_WORKFLOWS_DIRECTORY_PATH,
	]);
}

async function discoverSkillFiles(
	directoryPath: string,
): Promise<ReadonlyArray<UnifiedConfigFileCandidate>> {
	try {
		const entries = await readdir(directoryPath, { withFileTypes: true });
		const candidates: UnifiedConfigFileCandidate[] = [];
		for (const entry of entries) {
			if (entry.isFile() && entry.name === SKILL_FILE_NAME) {
				candidates.push({
					directoryPath,
					fileName: entry.name,
					filePath: join(directoryPath, entry.name),
				});
				continue;
			}
			if (entry.isDirectory()) {
				candidates.push({
					directoryPath: join(directoryPath, entry.name),
					fileName: SKILL_FILE_NAME,
					filePath: join(directoryPath, entry.name, SKILL_FILE_NAME),
				});
			}
		}
		return candidates;
	} catch (error) {
		const nodeError = error as NodeJS.ErrnoException;
		if (nodeError.code === "ENOENT") {
			return [];
		}
		throw error;
	}
}

async function discoverRulesLikeFiles(
	directoryPath: string,
): Promise<ReadonlyArray<UnifiedConfigFileCandidate>> {
	try {
		const entryStat = await stat(directoryPath);
		if (entryStat.isFile()) {
			return [
				{
					directoryPath: dirname(directoryPath),
					fileName: basename(directoryPath),
					filePath: directoryPath,
				},
			];
		}
	} catch (error) {
		const nodeError = error as NodeJS.ErrnoException;
		if (nodeError.code !== "ENOENT") {
			throw error;
		}
	}

	try {
		const entries = await readdir(directoryPath, { withFileTypes: true });
		return entries
			.filter((entry) => entry.isFile() && isMarkdownFile(entry.name))
			.map((entry) => ({
				directoryPath,
				fileName: entry.name,
				filePath: join(directoryPath, entry.name),
			}));
	} catch (error) {
		const nodeError = error as NodeJS.ErrnoException;
		if (nodeError.code === "ENOENT") {
			return [];
		}
		throw error;
	}
}

export function createSkillsConfigDefinition(
	options?: CreateSkillsConfigDefinitionOptions,
): UnifiedConfigDefinition<"skill", SkillConfig> {
	const directories =
		options?.directories ??
		resolveSkillsConfigSearchPaths(options?.workspacePath);

	return {
		type: "skill",
		directories,
		discoverFiles: discoverSkillFiles,
		includeFile: (fileName) => fileName === SKILL_FILE_NAME,
		parseFile: (context) =>
			parseSkillConfigFromMarkdown(
				context.content,
				basename(context.directoryPath),
			),
		resolveId: (skill) => normalizeName(skill.name),
	};
}

export function createRulesConfigDefinition(
	options?: CreateRulesConfigDefinitionOptions,
): UnifiedConfigDefinition<"rule", RuleConfig> {
	const directories =
		options?.directories ??
		resolveRulesConfigSearchPaths(options?.workspacePath);

	return {
		type: "rule",
		directories,
		discoverFiles: discoverRulesLikeFiles,
		includeFile: (fileName, filePath) =>
			fileName === ".clinerules" ||
			isMarkdownFile(fileName) ||
			isMarkdownFile(filePath),
		parseFile: (context) =>
			parseRuleConfigFromMarkdown(
				context.content,
				basename(context.filePath, extname(context.filePath)),
			),
		resolveId: (rule) => normalizeName(rule.name),
	};
}

export function createWorkflowsConfigDefinition(
	options?: CreateWorkflowsConfigDefinitionOptions,
): UnifiedConfigDefinition<"workflow", WorkflowConfig> {
	const directories =
		options?.directories ??
		resolveWorkflowsConfigSearchPaths(options?.workspacePath);

	return {
		type: "workflow",
		directories,
		discoverFiles: discoverRulesLikeFiles,
		includeFile: (fileName) => isMarkdownFile(fileName),
		parseFile: (context) =>
			parseWorkflowConfigFromMarkdown(
				context.content,
				basename(context.filePath, extname(context.filePath)),
			),
		resolveId: (workflow) => normalizeName(workflow.name),
	};
}

export interface CreateUserInstructionConfigWatcherOptions
	extends CreateInstructionWatcherOptions {
	skills?: CreateSkillsConfigDefinitionOptions;
	rules?: CreateRulesConfigDefinitionOptions;
	workflows?: CreateWorkflowsConfigDefinitionOptions;
}

export function createUserInstructionConfigWatcher(
	options?: CreateUserInstructionConfigWatcherOptions,
): UserInstructionConfigWatcher {
	const definitions: ReadonlyArray<
		UnifiedConfigDefinition<UserInstructionConfigType, UserInstructionConfig>
	> = [
		createSkillsConfigDefinition(options?.skills) as UnifiedConfigDefinition<
			UserInstructionConfigType,
			UserInstructionConfig
		>,
		createRulesConfigDefinition(options?.rules) as UnifiedConfigDefinition<
			UserInstructionConfigType,
			UserInstructionConfig
		>,
		createWorkflowsConfigDefinition(
			options?.workflows,
		) as UnifiedConfigDefinition<
			UserInstructionConfigType,
			UserInstructionConfig
		>,
	];

	return new UnifiedConfigFileWatcher(definitions, {
		debounceMs: options?.debounceMs,
		emitParseErrors: options?.emitParseErrors,
	});
}
