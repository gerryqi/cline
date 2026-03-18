import { getCliBuildInfo } from "../utils/common";
import { c, writeln } from "../utils/output";

type HelpItem = readonly [label: string, description: string];

function renderItems(items: readonly HelpItem[], indent = "  "): string[] {
	const width = items.reduce((max, [label]) => Math.max(max, label.length), 0);
	return items.map(
		([label, description]) => `${indent}${label.padEnd(width)}  ${description}`,
	);
}

function renderSection(title: string, items: readonly HelpItem[]): string {
	return [`${c.bold}${title}${c.reset}`, ...renderItems(items)].join("\n");
}

export function showHelp(): void {
	const { name } = getCliBuildInfo();
	const sections = [
		`${c.bold}${name}${c.reset} - a lightweight coding assistant built for your terminal`,
		renderSection("USAGE", [
			[`${name} [options] [prompt]`, "Run one prompt"],
			[`${name} -i`, "Start an interactive chat session"],
			[`echo "prompt" | ${name}`, "Read the prompt from stdin"],
		]),
		renderSection("COMMANDS", [
			[`${name} version`, "Show version"],
			[`${name} config`, "Open the interactive config view"],
			[`${name} auth <provider>`, "Authenticate or seed provider credentials"],
			[
				`${name} connect <adapter>`,
				"Run a chat connector bridge (telegram, gchat, whatsapp)",
			],
			[
				`${name} connect --stop [adapter]`,
				"Stop connector bridge processes and their sessions",
			],
			[
				`${name} list <workflows|rules|skills|agents|history|hooks|mcp>`,
				"List configs, history, or hook paths",
			],
			[`${name} schedule <command>`, "Create and manage scheduled runs"],
			[
				`${name} sessions <list|update|delete>`,
				"Inspect or edit saved sessions",
			],
			[`${name} dev log`, "Open the CLI runtime log file"],
			[`${name} hook`, "Handle a hook payload from stdin"],
			[`${name} rpc <command>`, "Manage the local RPC runtime server"],
		]),
		renderSection("RUN OPTIONS", [
			["-s, --system <prompt>", "Override the system prompt"],
			["-p, --provider <id>", "Provider id (default: cline)"],
			["-m, --model <id>", "Model id (default: anthropic/claude-sonnet-4.6)"],
			["-k, --key <api-key>", "API key override for this run"],
			["-i, --interactive", "Interactive multi-turn mode"],
			["--session <id>", "Resume an interactive session"],
			["--mode <act|plan>", "Tool preset mode (default: act)"],
			["-n, --max-iterations <n>", "Cap agent loop iterations"],
			[
				"--max-consecutive-mistakes <n>",
				"Consecutive internal mistake limit (default: 3)",
			],
			["--cwd <path>", "Working directory for tools"],
			["--thinking", "Enable model reasoning when supported"],
			[
				"--reasoning-effort <none|low|medium|high|xhigh>",
				"Set explicit model reasoning effort",
			],
			["-u, --usage", "Show token usage and estimated cost"],
			["-t, --timings", "Show timing details"],
			["--output <text|json>", "Output format (default: text)"],
			["--json", "Shorthand for --output json"],
			["--refresh-models", "Refresh the provider model catalog for this run"],
			["--verbose", "Show verbose runtime diagnostics (including hook traces)"],
		]),
		renderSection("TOOLS AND SANDBOX", [
			["--sandbox", "Use isolated local state instead of ~/.cline"],
			[
				"--sandbox-dir <path>",
				"Sandbox state dir (default: $CLINE_SANDBOX_DATA_DIR or /tmp/cline-sandbox)",
			],
			["--no-tools", "Disable tools"],
			["--no-spawn", "Disable spawn_agent"],
			["--no-teams", "Disable agent-team tools"],
			["--auto-approve-tools", "Skip tool approval prompts"],
			["--yolo", "Alias for --auto-approve-tools"],
			["--require-tool-approval", "Require approval for every tool call"],
			["--no-yolo", "Alias for --require-tool-approval"],
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
		]),
		renderSection("AUTH QUICK SETUP", [
			["-p, --provider <id>", "Provider id for auth setup"],
			["-k, --apikey <key>", "API key for auth setup"],
			["-m, --modelid <id>", "Model id for auth setup"],
			["-b, --baseurl <url>", "Base URL for OpenAI-compatible providers"],
		]),
		renderSection("CONNECT", [
			[
				`${name} connect telegram -m <bot> -k <token>`,
				"Start the Telegram bridge",
			],
			[
				`${name} connect gchat --base-url <url>`,
				"Start the Google Chat webhook bridge",
			],
			[
				`${name} connect whatsapp --base-url <url>`,
				"Start the WhatsApp webhook bridge",
			],
			[
				`${name} connect <adapter> --help`,
				"Show adapter-specific options and examples",
			],
			["--hook-command <command>", "Run a shell command for connector events"],
		]),
		renderSection("SCHEDULE SETUP", [
			[
				`${name} schedule create <name> --cron "<expr>" --prompt "<text>" --workspace <path>`,
				"Create a scheduled run",
			],
			[
				`${name} schedule <create|list|get|update|pause|resume|delete|trigger|history|stats|active|upcoming|import|export>`,
				"Manage schedules and execution history",
			],
		]),
		renderSection("RPC SHORTCUTS", [
			[
				`${name} rpc <start|status|stop|ensure> [--address <host:port>]`,
				"Manage the RPC server",
			],
			[
				`${name} rpc register --client-type <type> --client-id <id>`,
				"Register a client with the RPC server",
			],
			[
				`${name} rpc ensure --json`,
				"Ensure a compatible RPC server and print JSON",
			],
		]),
		renderSection("ENVIRONMENT", [
			["CLINE_API_KEY", "API key for the cline provider"],
			["CLINE_DATA_DIR", "Base data directory"],
			["CLINE_LOG_ENABLED", "Set to 0 or false to disable runtime logs"],
			[
				"CLINE_LOG_LEVEL",
				"Runtime log level (trace|debug|info|warn|error|fatal|silent)",
			],
			["CLINE_LOG_PATH", "Runtime log file path"],
			["CLINE_LOG_NAME", "Logger name for runtime log records"],
			["CLINE_SANDBOX", "Set to 1 to force sandbox mode"],
			["CLINE_SANDBOX_DATA_DIR", "Override the sandbox state directory"],
			["CLINE_TEAM_DATA_DIR", "Override team persistence"],
		]),
		renderSection("HELP", [
			["-h, --help", "Show this help"],
			["-v, --version", "Show version"],
		]),
	];

	writeln(sections.join("\n\n"));
}

export function showVersion(): void {
	writeln(getCliBuildInfo().version);
}
