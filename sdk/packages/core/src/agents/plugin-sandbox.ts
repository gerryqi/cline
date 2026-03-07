import type { AgentConfig, Tool } from "@cline/agents";
import { SubprocessSandbox } from "../runtime/sandbox/subprocess-sandbox";

export interface PluginSandboxOptions {
	pluginPaths: string[];
	exportName?: string;
	importTimeoutMs?: number;
	hookTimeoutMs?: number;
	contributionTimeoutMs?: number;
}

type AgentExtension = NonNullable<AgentConfig["extensions"]>[number];
type AgentExtensionApi = Parameters<NonNullable<AgentExtension["setup"]>>[0];
type HookStage =
	| "input"
	| "runtime_event"
	| "session_start"
	| "before_agent_start"
	| "tool_call_before"
	| "tool_call_after"
	| "turn_end"
	| "session_shutdown"
	| "error";

type SandboxedContributionDescriptor = {
	id: string;
	name: string;
	description?: string;
	inputSchema?: unknown;
	timeoutMs?: number;
	retryable?: boolean;
	value?: string;
	defaultValue?: boolean | string | number;
	metadata?: Record<string, unknown>;
};

type SandboxedPluginDescriptor = {
	pluginId: string;
	name: string;
	manifest: AgentExtension["manifest"];
	contributions: {
		tools: SandboxedContributionDescriptor[];
		commands: SandboxedContributionDescriptor[];
		shortcuts: SandboxedContributionDescriptor[];
		flags: SandboxedContributionDescriptor[];
		messageRenderers: SandboxedContributionDescriptor[];
		providers: SandboxedContributionDescriptor[];
	};
};

const PLUGIN_SANDBOX_BOOTSTRAP = `
const { pathToFileURL } = require("node:url");
let pluginCounter = 0;
const pluginState = new Map();

function toErrorPayload(error) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  return { message, stack };
}

function sendResponse(id, ok, result, error) {
  if (!process.send) return;
  process.send({ type: "response", id, ok, result, error });
}

function sanitizeObject(value) {
  if (!value || typeof value !== "object") return {};
  return value;
}

async function initialize(args) {
  const descriptors = [];
  const exportName = (args && args.exportName) || "plugin";
  for (const pluginPath of args.pluginPaths || []) {
    const moduleExports = await import(pathToFileURL(pluginPath).href);
    const plugin = moduleExports.default || moduleExports[exportName];
    if (!plugin || typeof plugin !== "object") {
      throw new Error(\`Invalid plugin module: \${pluginPath}\`);
    }
    if (typeof plugin.name !== "string" || !plugin.name) {
      throw new Error(\`Invalid plugin name: \${pluginPath}\`);
    }
    if (!plugin.manifest || typeof plugin.manifest !== "object") {
      throw new Error(\`Invalid plugin manifest: \${pluginPath}\`);
    }

    const pluginId = \`plugin_\${++pluginCounter}\`;
    const contributions = {
      tools: [],
      commands: [],
      shortcuts: [],
      flags: [],
      messageRenderers: [],
      providers: [],
    };
    const handlers = {
      tools: new Map(),
      commands: new Map(),
      messageRenderers: new Map(),
    };

    const makeId = (prefix) => \`\${pluginId}_\${prefix}_\${Math.random().toString(36).slice(2, 10)}\`;
    const api = {
      registerTool: (tool) => {
        const id = makeId("tool");
        handlers.tools.set(id, tool.execute);
        contributions.tools.push({
          id,
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          timeoutMs: tool.timeoutMs,
          retryable: tool.retryable,
        });
      },
      registerCommand: (command) => {
        const id = makeId("command");
        if (typeof command.handler === "function") {
          handlers.commands.set(id, command.handler);
        }
        contributions.commands.push({
          id,
          name: command.name,
          description: command.description,
        });
      },
      registerShortcut: (shortcut) => {
        contributions.shortcuts.push({
          id: makeId("shortcut"),
          name: shortcut.name,
          value: shortcut.value,
          description: shortcut.description,
        });
      },
      registerFlag: (flag) => {
        contributions.flags.push({
          id: makeId("flag"),
          name: flag.name,
          description: flag.description,
          defaultValue: flag.defaultValue,
        });
      },
      registerMessageRenderer: (renderer) => {
        const id = makeId("renderer");
        handlers.messageRenderers.set(id, renderer.render);
        contributions.messageRenderers.push({ id, name: renderer.name });
      },
      registerProvider: (provider) => {
        contributions.providers.push({
          id: makeId("provider"),
          name: provider.name,
          description: provider.description,
          metadata: sanitizeObject(provider.metadata),
        });
      },
    };

    if (typeof plugin.setup === "function") {
      await plugin.setup(api);
    }

    pluginState.set(pluginId, { plugin, handlers });
    descriptors.push({
      pluginId,
      name: plugin.name,
      manifest: plugin.manifest,
      contributions,
    });
  }
  return descriptors;
}

function getPlugin(pluginId) {
  const state = pluginState.get(pluginId);
  if (!state) {
    throw new Error(\`Unknown sandbox plugin id: \${pluginId}\`);
  }
  return state;
}

async function invokeHook(args) {
  const state = getPlugin(args.pluginId);
  const handler = state.plugin[args.hookName];
  if (typeof handler !== "function") {
    return undefined;
  }
  return await handler(args.payload);
}

async function executeTool(args) {
  const state = getPlugin(args.pluginId);
  const handler = state.handlers.tools.get(args.contributionId);
  if (typeof handler !== "function") {
    throw new Error("Unknown sandbox tool contribution");
  }
  return await handler(args.input, args.context);
}

async function executeCommand(args) {
  const state = getPlugin(args.pluginId);
  const handler = state.handlers.commands.get(args.contributionId);
  if (typeof handler !== "function") {
    return "";
  }
  return await handler(args.input);
}

async function renderMessage(args) {
  const state = getPlugin(args.pluginId);
  const handler = state.handlers.messageRenderers.get(args.contributionId);
  if (typeof handler !== "function") {
    return "";
  }
  return await handler(args.message);
}

const methods = { initialize, invokeHook, executeTool, executeCommand, renderMessage };

process.on("message", async (message) => {
  if (!message || message.type !== "call") {
    return;
  }
  const method = methods[message.method];
  if (!method) {
    sendResponse(message.id, false, undefined, { message: \`Unknown method: \${String(message.method)}\` });
    return;
  }
  try {
    const result = await method(message.args || {});
    sendResponse(message.id, true, result);
  } catch (error) {
    sendResponse(message.id, false, undefined, toErrorPayload(error));
  }
});
`;

function hasHookStage(extension: AgentExtension, stage: HookStage): boolean {
	return extension.manifest.hookStages?.includes(stage) === true;
}

function withTimeoutFallback(
	timeoutMs: number | undefined,
	fallback: number,
): number {
	return typeof timeoutMs === "number" && timeoutMs > 0 ? timeoutMs : fallback;
}

export async function loadSandboxedPlugins(
	options: PluginSandboxOptions,
): Promise<{
	extensions: AgentConfig["extensions"];
	shutdown: () => Promise<void>;
}> {
	const sandbox = new SubprocessSandbox({
		name: "plugin-sandbox",
		bootstrapScript: PLUGIN_SANDBOX_BOOTSTRAP,
	});
	const importTimeoutMs = withTimeoutFallback(options.importTimeoutMs, 4000);
	const hookTimeoutMs = withTimeoutFallback(options.hookTimeoutMs, 3000);
	const contributionTimeoutMs = withTimeoutFallback(
		options.contributionTimeoutMs,
		5000,
	);

	let descriptors: SandboxedPluginDescriptor[];
	try {
		descriptors = await sandbox.call<SandboxedPluginDescriptor[]>(
			"initialize",
			{
				pluginPaths: options.pluginPaths,
				exportName: options.exportName,
			},
			{ timeoutMs: importTimeoutMs },
		);
	} catch (error) {
		await sandbox.shutdown().catch(() => {
			// Best-effort cleanup when sandbox initialization fails.
		});
		throw error;
	}

	const extensions: NonNullable<AgentConfig["extensions"]> = descriptors.map(
		(descriptor) => {
			const extension: AgentExtension = {
				name: descriptor.name,
				manifest: descriptor.manifest,
				setup: (api: AgentExtensionApi) => {
					for (const toolDescriptor of descriptor.contributions.tools) {
						const tool: Tool = {
							name: toolDescriptor.name,
							description: toolDescriptor.description ?? "",
							inputSchema: (toolDescriptor.inputSchema ?? {
								type: "object",
								properties: {},
							}) as Tool["inputSchema"],
							timeoutMs: toolDescriptor.timeoutMs,
							retryable: toolDescriptor.retryable,
							execute: async (input: unknown, context: unknown) =>
								await sandbox.call(
									"executeTool",
									{
										pluginId: descriptor.pluginId,
										contributionId: toolDescriptor.id,
										input,
										context,
									},
									{ timeoutMs: contributionTimeoutMs },
								),
						};
						api.registerTool(tool);
					}

					for (const commandDescriptor of descriptor.contributions.commands) {
						api.registerCommand({
							name: commandDescriptor.name,
							description: commandDescriptor.description,
							handler: async (input: string) =>
								await sandbox.call<string>(
									"executeCommand",
									{
										pluginId: descriptor.pluginId,
										contributionId: commandDescriptor.id,
										input,
									},
									{ timeoutMs: contributionTimeoutMs },
								),
						});
					}

					for (const shortcutDescriptor of descriptor.contributions.shortcuts) {
						api.registerShortcut({
							name: shortcutDescriptor.name,
							value: shortcutDescriptor.value ?? "",
							description: shortcutDescriptor.description,
						});
					}

					for (const flagDescriptor of descriptor.contributions.flags) {
						api.registerFlag({
							name: flagDescriptor.name,
							description: flagDescriptor.description,
							defaultValue: flagDescriptor.defaultValue,
						});
					}

					for (const rendererDescriptor of descriptor.contributions
						.messageRenderers) {
						api.registerMessageRenderer({
							name: rendererDescriptor.name,
							render: () =>
								`[sandbox renderer ${rendererDescriptor.name} requires async bridge]`,
						});
					}

					for (const providerDescriptor of descriptor.contributions.providers) {
						api.registerProvider({
							name: providerDescriptor.name,
							description: providerDescriptor.description,
							metadata: providerDescriptor.metadata,
						});
					}
				},
			};

			if (hasHookStage(extension, "input")) {
				extension.onInput = async (payload: unknown) =>
					await sandbox.call(
						"invokeHook",
						{ pluginId: descriptor.pluginId, hookName: "onInput", payload },
						{ timeoutMs: hookTimeoutMs },
					);
			}
			if (hasHookStage(extension, "session_start")) {
				extension.onSessionStart = async (payload: unknown) =>
					await sandbox.call(
						"invokeHook",
						{
							pluginId: descriptor.pluginId,
							hookName: "onSessionStart",
							payload,
						},
						{ timeoutMs: hookTimeoutMs },
					);
			}
			if (hasHookStage(extension, "before_agent_start")) {
				extension.onBeforeAgentStart = async (payload: unknown) =>
					await sandbox.call(
						"invokeHook",
						{
							pluginId: descriptor.pluginId,
							hookName: "onBeforeAgentStart",
							payload,
						},
						{ timeoutMs: hookTimeoutMs },
					);
			}
			if (hasHookStage(extension, "tool_call_before")) {
				extension.onToolCall = async (payload: unknown) =>
					await sandbox.call(
						"invokeHook",
						{ pluginId: descriptor.pluginId, hookName: "onToolCall", payload },
						{ timeoutMs: hookTimeoutMs },
					);
			}
			if (hasHookStage(extension, "tool_call_after")) {
				extension.onToolResult = async (payload: unknown) =>
					await sandbox.call(
						"invokeHook",
						{
							pluginId: descriptor.pluginId,
							hookName: "onToolResult",
							payload,
						},
						{ timeoutMs: hookTimeoutMs },
					);
			}
			if (hasHookStage(extension, "turn_end")) {
				extension.onAgentEnd = async (payload: unknown) =>
					await sandbox.call(
						"invokeHook",
						{ pluginId: descriptor.pluginId, hookName: "onAgentEnd", payload },
						{ timeoutMs: hookTimeoutMs },
					);
			}
			if (hasHookStage(extension, "session_shutdown")) {
				extension.onSessionShutdown = async (payload: unknown) =>
					await sandbox.call(
						"invokeHook",
						{
							pluginId: descriptor.pluginId,
							hookName: "onSessionShutdown",
							payload,
						},
						{ timeoutMs: hookTimeoutMs },
					);
			}
			if (hasHookStage(extension, "runtime_event")) {
				extension.onRuntimeEvent = async (payload: unknown) => {
					await sandbox.call(
						"invokeHook",
						{
							pluginId: descriptor.pluginId,
							hookName: "onRuntimeEvent",
							payload,
						},
						{ timeoutMs: hookTimeoutMs },
					);
				};
			}
			if (hasHookStage(extension, "error")) {
				extension.onError = async (payload: unknown) => {
					await sandbox.call(
						"invokeHook",
						{ pluginId: descriptor.pluginId, hookName: "onError", payload },
						{ timeoutMs: hookTimeoutMs },
					);
				};
			}

			return extension;
		},
	);

	return {
		extensions,
		shutdown: async () => {
			await sandbox.shutdown();
		},
	};
}
