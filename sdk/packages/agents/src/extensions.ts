import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type {
	AgentExtension,
	AgentExtensionApi,
	AgentExtensionBeforeAgentStartContext,
	AgentExtensionBeforeAgentStartControl,
	AgentExtensionCommand,
	AgentExtensionFlag,
	AgentExtensionInputContext,
	AgentExtensionMessageRenderer,
	AgentExtensionProvider,
	AgentExtensionRegistry,
	AgentExtensionRuntimeEventContext,
	AgentExtensionSessionShutdownContext,
	AgentExtensionSessionStartContext,
	AgentExtensionShortcut,
	AgentHookControl,
	AgentHookErrorContext,
	AgentHookToolCallEndContext,
	AgentHookToolCallStartContext,
	AgentHookTurnEndContext,
	Tool,
} from "./types.js";

export interface AgentExtensionRunnerOptions {
	extensions?: AgentExtension[];
}

export interface LoadExtensionModuleOptions {
	exportName?: string;
}

function mergeHookControl(
	base: AgentHookControl,
	next: AgentHookControl | undefined,
): AgentHookControl {
	if (!next) {
		return base;
	}

	return {
		cancel: base.cancel || next.cancel,
		context: [base.context, next.context]
			.filter((value): value is string => typeof value === "string" && !!value)
			.join("\n"),
		overrideInput: Object.hasOwn(next, "overrideInput")
			? next.overrideInput
			: base.overrideInput,
	};
}

export class AgentExtensionRunner {
	private readonly extensions: AgentExtension[];
	private initialized = false;
	private readonly registry: AgentExtensionRegistry = {
		tools: [],
		commands: [],
		shortcuts: [],
		flags: [],
		messageRenderers: [],
		providers: [],
	};

	constructor(options: AgentExtensionRunnerOptions = {}) {
		this.extensions = options.extensions ?? [];
	}

	async initialize(): Promise<void> {
		if (this.initialized) {
			return;
		}

		const api: AgentExtensionApi = {
			registerTool: (tool) => this.registry.tools.push(tool),
			registerCommand: (command) => this.registry.commands.push(command),
			registerShortcut: (shortcut) => this.registry.shortcuts.push(shortcut),
			registerFlag: (flag) => this.registry.flags.push(flag),
			registerMessageRenderer: (renderer) =>
				this.registry.messageRenderers.push(renderer),
			registerProvider: (provider) => this.registry.providers.push(provider),
		};

		for (const extension of this.extensions) {
			await extension.setup?.(api);
		}

		this.initialized = true;
	}

	getRegisteredTools(): Tool[] {
		return [...this.registry.tools];
	}

	getRegistrySnapshot(): AgentExtensionRegistry {
		return {
			tools: [...this.registry.tools],
			commands: [...this.registry.commands],
			shortcuts: [...this.registry.shortcuts],
			flags: [...this.registry.flags],
			messageRenderers: [...this.registry.messageRenderers],
			providers: [...this.registry.providers],
		};
	}

	getRegisteredCommands(): AgentExtensionCommand[] {
		return [...this.registry.commands];
	}

	getRegisteredShortcuts(): AgentExtensionShortcut[] {
		return [...this.registry.shortcuts];
	}

	getRegisteredFlags(): AgentExtensionFlag[] {
		return [...this.registry.flags];
	}

	getRegisteredMessageRenderers(): AgentExtensionMessageRenderer[] {
		return [...this.registry.messageRenderers];
	}

	getRegisteredProviders(): AgentExtensionProvider[] {
		return [...this.registry.providers];
	}

	async onSessionStart(
		ctx: AgentExtensionSessionStartContext,
	): Promise<AgentHookControl | undefined> {
		let merged: AgentHookControl = {};
		for (const extension of this.extensions) {
			const result = await extension.onSessionStart?.(ctx);
			const control =
				result && typeof result === "object"
					? (result as AgentHookControl)
					: undefined;
			merged = mergeHookControl(merged, control);
		}
		return Object.keys(merged).length > 0 ? merged : undefined;
	}

	async onInput(
		ctx: AgentExtensionInputContext,
	): Promise<{ input: string; control?: AgentHookControl }> {
		let input = ctx.input;
		let merged: AgentHookControl = {};

		for (const extension of this.extensions) {
			const result = await extension.onInput?.({ ...ctx, input });
			const control =
				result && typeof result === "object"
					? (result as AgentHookControl)
					: undefined;
			merged = mergeHookControl(merged, control);
			if (control?.context) {
				// context merge handled in merged; no-op here
			}
		}

		if (
			Object.hasOwn(merged, "overrideInput") &&
			typeof merged.overrideInput === "string"
		) {
			input = merged.overrideInput;
		}

		return {
			input,
			control: Object.keys(merged).length > 0 ? merged : undefined,
		};
	}

	async onBeforeAgentStart(
		ctx: AgentExtensionBeforeAgentStartContext,
	): Promise<{
		systemPrompt: string;
		appendMessages: NonNullable<
			AgentExtensionBeforeAgentStartControl["appendMessages"]
		>;
		control?: AgentHookControl;
	}> {
		let systemPrompt = ctx.systemPrompt;
		const appendMessages: NonNullable<
			AgentExtensionBeforeAgentStartControl["appendMessages"]
		> = [];
		let mergedControl: AgentHookControl = {};

		for (const extension of this.extensions) {
			const control = await extension.onBeforeAgentStart?.({
				...ctx,
				systemPrompt,
			});
			if (!control) {
				continue;
			}

			mergedControl = mergeHookControl(mergedControl, control);
			if (typeof control.systemPrompt === "string") {
				systemPrompt = control.systemPrompt;
			}
			if (Array.isArray(control.appendMessages)) {
				appendMessages.push(...control.appendMessages);
			}
		}

		return {
			systemPrompt,
			appendMessages,
			control:
				Object.keys(mergedControl).length > 0 ? mergedControl : undefined,
		};
	}

	async onToolCall(
		ctx: AgentHookToolCallStartContext,
	): Promise<AgentHookControl | undefined> {
		let merged: AgentHookControl = {};
		for (const extension of this.extensions) {
			const result = await extension.onToolCall?.(ctx);
			const control =
				result && typeof result === "object"
					? (result as AgentHookControl)
					: undefined;
			merged = mergeHookControl(merged, control);
		}
		return Object.keys(merged).length > 0 ? merged : undefined;
	}

	async onToolResult(
		ctx: AgentHookToolCallEndContext,
	): Promise<AgentHookControl | undefined> {
		let merged: AgentHookControl = {};
		for (const extension of this.extensions) {
			const result = await extension.onToolResult?.(ctx);
			const control =
				result && typeof result === "object"
					? (result as AgentHookControl)
					: undefined;
			merged = mergeHookControl(merged, control);
		}
		return Object.keys(merged).length > 0 ? merged : undefined;
	}

	async onAgentEnd(
		ctx: AgentHookTurnEndContext,
	): Promise<AgentHookControl | undefined> {
		let merged: AgentHookControl = {};
		for (const extension of this.extensions) {
			const result = await extension.onAgentEnd?.(ctx);
			const control =
				result && typeof result === "object"
					? (result as AgentHookControl)
					: undefined;
			merged = mergeHookControl(merged, control);
		}
		return Object.keys(merged).length > 0 ? merged : undefined;
	}

	async onSessionShutdown(
		ctx: AgentExtensionSessionShutdownContext,
	): Promise<AgentHookControl | undefined> {
		let merged: AgentHookControl = {};
		for (const extension of this.extensions) {
			const result = await extension.onSessionShutdown?.(ctx);
			const control =
				result && typeof result === "object"
					? (result as AgentHookControl)
					: undefined;
			merged = mergeHookControl(merged, control);
		}
		return Object.keys(merged).length > 0 ? merged : undefined;
	}

	async onRuntimeEvent(ctx: AgentExtensionRuntimeEventContext): Promise<void> {
		for (const extension of this.extensions) {
			await extension.onRuntimeEvent?.(ctx);
		}
	}

	async onError(ctx: AgentHookErrorContext): Promise<void> {
		for (const extension of this.extensions) {
			await extension.onError?.(ctx);
		}
	}
}

export function createExtensionRunner(
	options: AgentExtensionRunnerOptions = {},
): AgentExtensionRunner {
	return new AgentExtensionRunner(options);
}

/**
 * Load a single extension module from disk.
 * Supports default export and named export (`extension` by default).
 */
export async function loadExtensionModule(
	modulePath: string,
	options: LoadExtensionModuleOptions = {},
): Promise<AgentExtension> {
	const absolutePath = resolve(modulePath);
	const mod = (await import(pathToFileURL(absolutePath).href)) as Record<
		string,
		unknown
	>;
	const exportName = options.exportName ?? "extension";
	const extension = (mod.default ?? mod[exportName]) as
		| AgentExtension
		| undefined;

	if (
		!extension ||
		typeof extension !== "object" ||
		typeof extension.name !== "string"
	) {
		throw new Error(`Invalid extension module at ${absolutePath}`);
	}

	return extension;
}

/**
 * Load multiple extension modules from absolute or relative paths.
 */
export async function loadExtensionsFromPaths(
	modulePaths: string[],
	options: LoadExtensionModuleOptions = {},
): Promise<AgentExtension[]> {
	const loaded: AgentExtension[] = [];
	for (const modulePath of modulePaths) {
		loaded.push(await loadExtensionModule(modulePath, options));
	}
	return loaded;
}

/**
 * Discover extension module files recursively from a directory.
 * Matching files: `.js`, `.mjs`, `.cjs`, `.ts`.
 */
export function discoverExtensionModules(directory: string): string[] {
	const root = resolve(directory);
	if (!existsSync(root)) {
		return [];
	}

	const discovered: string[] = [];
	const stack = [root];
	const allowed = new Set([".js", ".mjs", ".cjs", ".ts"]);

	while (stack.length > 0) {
		const current = stack.pop();
		if (!current) {
			continue;
		}
		for (const entry of readdirSync(current)) {
			const path = join(current, entry);
			const stats = statSync(path);
			if (stats.isDirectory()) {
				stack.push(path);
				continue;
			}
			const extension = path.slice(path.lastIndexOf("."));
			if (allowed.has(extension)) {
				discovered.push(path);
			}
		}
	}

	return discovered.sort();
}
