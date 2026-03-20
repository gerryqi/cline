import { getCliBuildInfo } from "../utils/common";
import { writeln } from "../utils/output";

type HelpItem = readonly [label: string, description: string];

function renderItems(items: readonly HelpItem[], indent = "  "): string[] {
	const width = items.reduce((max, [label]) => Math.max(max, label.length), 0);
	return items.map(
		([label, description]) => `${indent}${label.padEnd(width)}  ${description}`,
	);
}

function renderSection(title: string, items: readonly HelpItem[]): string {
	return [`${title}`, ...renderItems(items)].join("\n");
}

export function showHelp(): void {
	const { name } = getCliBuildInfo();
	const lines = [
		`Usage: ${name} [options] [command] [prompt]`,
		"",
		"Cline CLI - AI coding assistant in your terminal",
		"",
		renderSection("Arguments:", [
			["prompt", "Task prompt (starts task immediately)"],
		]),
		"",
		renderSection("Options:", [
			["-V, --version", "output the version number"],
			["-a, --act", "Run in act mode"],
			["-p, --plan", "Run in plan mode"],
			[
				"-y, --yolo",
				"Enable yolo mode (auto-approve actions) with hooks disabled",
			],
			[
				"--auto-approve-all",
				"Enable auto-approve all actions while keeping interactive mode",
			],
			[
				"-t, --timeout <seconds>",
				"Optional timeout in seconds (applies only when provided)",
			],
			["-m, --model <model>", "Model to use for the task"],
			["-v, --verbose", "Show verbose output"],
			["-c, --cwd <path>", "Working directory"],
			["--config <path>", "Configuration directory"],
			[
				"--thinking [tokens]",
				"Enable extended thinking (default: 1024 tokens)",
			],
			[
				"--reasoning-effort <effort>",
				"Reasoning effort: none|low|medium|high|xhigh",
			],
			[
				"--max-consecutive-mistakes <count>",
				"Maximum consecutive mistakes before halting in yolo mode",
			],
			["--json", "Output messages as JSON instead of styled text"],
			[
				"--hooks-dir <path>",
				"Path to additional hooks directory for runtime hook injection",
			],
			[
				"--acp",
				"[TODO] Run in ACP (Agent Client Protocol) mode for editor integration",
			],
			["-T, --taskId <id>", "Resume an existing task by ID"],
			["-h, --help", "display help for command"],
			["-i, --interactive", "Start interactive chat mode"],
			["-s, --system <prompt>", "Override the system prompt"],
			["-P, --provider <id>", "Provider id (default: cline)"],
			["--key <api-key>", "API key override for this run"],
			["--sandbox", "Use isolated local state instead of ~/.cline"],
			[
				"--sandbox-dir <path>",
				"Sandbox state dir (default: $CLINE_SANDBOX_DATA_DIR or /tmp/cline-sandbox)",
			],
			["--no-tools", "Disable tools"],
			["--no-spawn", "Disable spawn_agent"],
			["--no-teams", "Disable agent-team tools"],
			["--require-tool-approval", "Require approval for every tool call"],
			["--tool-enable <name>", "Explicitly enable one tool"],
			["--tool-disable <name>", "Explicitly disable one tool"],
			["--tool-autoapprove <name>", "Always approve one tool"],
			[
				"--tool-require-approval <name>",
				"Always require approval for one tool",
			],
			["--team-name <name>", "Override the runtime team state name"],
			[
				"--mission-step-interval <n>",
				"Mission log update cadence in meaningful steps",
			],
			[
				"--mission-time-interval-ms <ms>",
				"Mission log update cadence in milliseconds",
			],
			["--refresh-models", "Refresh provider model catalog for this run"],
			["-u, --usage", "Show token usage and estimated cost"],
			["--timings", "Show timing details"],
		]),
		"",
		renderSection("Commands:", [
			["task|t [options] <prompt>", "Run a new task in a new session"],
			["history|h [options]", "List session history or manage saved sessions"],
			["config [options]", "Show current configuration"],
			[
				"auth [options]",
				"Authenticate a provider and configure what model is used",
			],
			["version", "Show Cline CLI version number"],
			["update [options]", "[TODO] Check for updates and install if available"],
			["dev", "Developer tools and utilities"],
			[
				"doctor [--fix] [--json] [--verbose]",
				"Inspect or clean stale local CLI/RPC processes",
			],
			[
				"connect [options] <adapter>",
				"Run a chat connector bridge (telegram, gchat, whatsapp). Use --stop to stop the bridge and its sessions",
			],
			[
				"list <workflows|rules|skills|agents|hooks|mcp>",
				"List configs or hook paths",
			],
			[
				"schedule <create|get|list|update|stats>",
				"Create and manage scheduled runs",
			],
			[
				"history <update|delete> [options]",
				"Programmatic CRUD surface for saved sessions (use with --json)",
			],
			["hook", "Handle a hook payload from stdin"],
			["rpc <command>", "Manage the local RPC runtime server"],
		]),
	];

	writeln(lines.join("\n"));
}

export function showVersion(): void {
	writeln(getCliBuildInfo().version);
}
