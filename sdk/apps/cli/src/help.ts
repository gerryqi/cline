import { version } from "../package.json";
import { c, writeln } from "./utils/output";

export function showHelp(): void {
	writeln(`${c.bold}clite${c.reset} - Lightweight CLI for Cline agentic capabilities

${c.bold}USAGE${c.reset}
  clite [OPTIONS] [PROMPT]
  clite -i                    Interactive mode
  clite config                Open interactive config view
  clite auth <provider>       Authenticate with a provider (cline|openai-codex|oca)
  clite connect <adapter>     Launch an adapter bridge into RPC chat sessions
  clite connect --stop        Stop running adapter bridges and their sessions
  clite dev log               Open the CLI runtime log file
  clite hook < payload.json   Handle hook payload from stdin
  clite schedule <command>    Manage scheduled agent runs via RPC server
  clite list <workflows|rules|skills|agents|history|hooks|mcp>
                              List workflow/rule/skill/agent configs, history, or hook file paths
  echo "prompt" | clite       Pipe input

${c.bold}OPTIONS${c.reset}
  -s, --system <prompt>       System prompt for the agent
  -m, --model <id>            Model ID (default: anthropic/claude-sonnet-4.6)
  -p, --provider <id>         Provider ID (default: cline)
  -k, --key <api-key>         API key override for this run
  -n, --max-iterations <n>    Max agentic loop iterations (optional; unset means unbounded)
  -i, --interactive           Interactive mode with multi-turn conversation
  -u, --usage                 Show token usage and estimated cost after response
  -t, --timings               Show timing information
  --thinking                  Enable model thinking/reasoning when supported
  --refresh-models        	  Refresh provider model catalog from live endpoints for this run
  --mode <act|plan>           Agent mode for tool presets (default: act)
  --output <text|json>        Output format (default: text)
  --json                      Shorthand for --output json (NDJSON stream)
  --sandbox                   Run with isolated local state (no writes to ~/.cline)
  --sandbox-dir <path>        Sandbox state directory (default: $CLINE_SANDBOX_DATA_DIR or /tmp/cline-sandbox)
  --no-tools                  Disable default tools (enabled by default)
  --no-spawn                  Disable spawn_agent tool (enabled by default)
  --no-teams                  Disable agent-team tools (enabled by default)
  --auto-approve-tools        Skip approval prompts for tools (default)
  --require-tool-approval     Require approval before each tool call
  --tool-enable <name>        Explicitly enable a tool
  --tool-disable <name>       Explicitly disable a tool
  --tool-autoapprove <name>   Auto-approve a specific tool
  --tool-require-approval <name>
                              Require approval for a specific tool
  --team-name <name>          Team name for runtime state (default: agent-team-\${nanoid(5)})
  --mission-step-interval <n> Mission log update interval in meaningful steps (default: 3)
  --mission-time-interval-ms <ms>
                              Mission log update interval in milliseconds (default: 120000)
  --cwd <path>                Working directory for tools (default: current dir)
  --session <id>              Resume interactive chat from a saved session id
  auth options:
    -p, --provider <id>       Provider ID for auth quick setup
    -k, --apikey <key>        API key for auth quick setup
    -m, --modelid <id>        Model ID for auth quick setup
    -b, --baseurl <url>       Base URL for auth quick setup (openai/openai-native)
  connect telegram options:
    -m, --bot-username <name> Telegram bot username
    -k, --bot-token <token>   Telegram bot token
    --provider <id>           Provider override for Telegram sessions
    --model <id>              Model override for Telegram sessions
    --api-key <key>           Provider API key override for Telegram sessions
    --enable-tools            Enable tools for Telegram sessions (off by default)
    --hook-command <command>  Run a shell command for connector events
                              Connector hook payloads use the shared ConnectorHookEvent schema
  connect stop:
    clite connect --stop              Stop all running adapters and their sessions
    clite connect --stop telegram     Stop all Telegram adapters and their sessions
  -h, --help                  Show this help
  -v, --version               Show version

${c.bold}ENVIRONMENT${c.reset}
  CLINE_API_KEY               API key for CLINE (when using -p cline)
  CLINE_DATA_DIR              Base data directory (sessions/settings/teams/hooks)
  CLINE_LOG_ENABLED           Set to 0/false to disable runtime file logging
  CLINE_LOG_LEVEL             Runtime log level (trace/debug/info/warn/error/fatal/silent)
  CLINE_LOG_PATH              Runtime log file path (default: <CLINE_DATA_DIR>/logs/clite.log)
  CLINE_LOG_NAME              Logger name for runtime log records
  CLINE_SANDBOX               Set to 1 to force sandbox mode
  CLINE_SANDBOX_DATA_DIR      Override sandbox state directory
  CLINE_TEAM_DATA_DIR         Override team persistence directory

${c.bold}INTERNAL${c.reset}
  clite rpc <start|status|stop|ensure> --address <host:port>
						  RPC server commands with custom address
  clite rpc register --client-type <type> --client-id <id>
						  Register a client with RPC server (e.g. --client-type desktop --client-id example)
  clite rpc ensure --json
						  Ensure compatible runtime server, auto-selecting a new port when needed
  clite schedule create <name> --cron "<expr>" --prompt "<text>" --workspace <path>
						  Create a scheduled agent execution
						  Add --delivery-adapter telegram --delivery-thread <thread-id> --delivery-bot <bot> to route results back through a connector
  clite schedule <create|list|get|update|pause|resume|delete|trigger|history|stats|active|upcoming|import|export>
						  Manage schedules and execution history
  clite dev log
						  Open ~/.cline/data/logs/clite.log
`);
}

export function showVersion(): void {
	writeln(version);
}
