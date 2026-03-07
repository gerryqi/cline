import { version } from "../package.json";
import { c, writeln } from "./utils/output";

export function showHelp(): void {
	writeln(`${c.bold}clite${c.reset} - Lightweight CLI for Cline agentic capabilities

${c.bold}USAGE${c.reset}
  clite [OPTIONS] [PROMPT]
  clite -i                    Interactive mode
  clite config                Open interactive config view
  clite auth <provider>       Authenticate with a provider (cline|openai-codex|oca)
  clite hook < payload.json   Handle hook payload from stdin
  clite list <workflows|rules|skills|agents|history|hooks|mcp>
                              List workflow/rule/skill/agent configs, history, or hook file paths
  echo "prompt" | clite       Pipe input

${c.bold}OPTIONS${c.reset}
  -s, --system <prompt>       System prompt for the agent
  -m, --model <id>            Model ID (default: anthropic/claude-sonnet-4.6)
  -p, --provider <id>         Provider ID (default: cline)
  -k, --key <api-key>         API key override for this run
  -n, --max-iterations <n>    Max agentic loop iterations (currently ignored; runtime is unbounded)
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
  -h, --help                  Show this help
  -v, --version               Show version

${c.bold}ENVIRONMENT${c.reset}
  ANTHROPIC_API_KEY           API key for Anthropic
  CLINE_API_KEY               API key for CLINE (when using -p cline)
  CLINE_DATA_DIR              Base data directory (sessions/settings/teams/hooks)
  CLINE_LOG_ENABLED           Set to 0/false to disable runtime file logging
  CLINE_LOG_LEVEL             Runtime log level (trace/debug/info/warn/error/fatal/silent)
  CLINE_LOG_PATH              Runtime log file path (default: <CLINE_DATA_DIR>/logs/clite.log)
  CLINE_LOG_NAME              Logger name for runtime log records
  CLINE_SANDBOX               Set to 1 to force sandbox mode
  CLINE_SANDBOX_DATA_DIR      Override sandbox state directory
  CLINE_TEAM_DATA_DIR         Override team persistence directory
  OPENAI_API_KEY              API key for OpenAI (when using -p openai)
  OPENROUTER_API_KEY          API key for Openrouter (when using -p openrouter)
  AI_GATEWAY_API_KEY          API key for Vercel AI Gateway (when using -p vercel-ai-gateway)

${c.bold}EXAMPLES${c.reset}
  clite list history
  clite --session 1700000000000_abcde_cli
  clite list workflows
  clite list rules --json
  clite list skills
  clite list agents
  clite list hooks
  clite list mcp
  clite config
  clite auth
  clite auth openai-codex
  clite auth --provider anthropic --apikey sk-xxx --modelid claude-sonnet-4-6
  clite auth oca
  clite "What is 2+2?"
  clite "Read package.json and summarize it"
  clite "Search for TODO comments in the codebase"
  clite -s "You are a pirate" "Tell me about the sea"
  clite -i
  clite --tools --teams "Create teammates for planner/coder/reviewer and execute tasks"
  clite --no-tools "Answer from general knowledge only"
  cat file.txt | clite "Summarize this"

${c.bold}INTERNAL${c.reset}
  clite rpc <start|status|stop|ensure> --address <host:port>
						  RPC server commands with custom address
  clite rpc register --client-type <type> --client-id <id>
						  Register a client with RPC server (e.g. --client-type desktop --client-id example)
  clite rpc ensure --json
						  Ensure compatible runtime server, auto-selecting a new port when needed
`);
}

export function showVersion(): void {
	writeln(version);
}
