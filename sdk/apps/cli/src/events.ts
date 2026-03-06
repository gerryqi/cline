import type { AgentEvent, TeamEvent } from "@cline/agents";
import {
	c,
	emitJsonLine,
	getCurrentOutputMode,
	write,
	writeErr,
} from "./output";
import { formatToolInput, formatToolOutput, truncate } from "./utils/helpers";
import type { Config } from "./utils/types";

// =============================================================================
// Inline stream state
// =============================================================================

let activeInlineStream: "text" | "reasoning" | undefined;
let inlineStreamHasOutput = false;

export function closeInlineStreamIfNeeded(): void {
	if (!inlineStreamHasOutput) {
		return;
	}
	write("\n");
	activeInlineStream = undefined;
	inlineStreamHasOutput = false;
}

// =============================================================================
// Agent event handler
// =============================================================================

const isDev = process.env.NODE_ENV === "development";

export function handleEvent(event: AgentEvent, _config: Config): void {
	if (getCurrentOutputMode() === "json") {
		emitJsonLine("stdout", { type: "agent_event", event });
		return;
	}

	switch (event.type) {
		case "iteration_start":
			closeInlineStreamIfNeeded();
			if (isDev) {
				write(`\n${c.yellow}── iteration ${event.iteration} ──${c.reset}\n`);
			}
			break;

		case "iteration_end":
			closeInlineStreamIfNeeded();
			if (!event.hadToolCalls) {
				// write(`\n\n${c.dim}(no tools called, done)${c.reset}\n`)
			}
			break;

		case "content_start":
			switch (event.contentType) {
				case "text":
					if (activeInlineStream !== "text") {
						closeInlineStreamIfNeeded();
						activeInlineStream = "text";
					}
					write(event.text ?? "");
					inlineStreamHasOutput = true;
					break;
				case "reasoning":
					if (activeInlineStream !== "reasoning") {
						closeInlineStreamIfNeeded();
						write(`${c.dim}[thinking] ${c.reset}`);
						activeInlineStream = "reasoning";
						inlineStreamHasOutput = true;
					}
					if (event.redacted && !event.reasoning) {
						write(`${c.dim}[redacted]${c.reset}`);
						inlineStreamHasOutput = true;
						break;
					}
					write(`${c.dim}${event.reasoning ?? ""}${c.reset}`);
					inlineStreamHasOutput = true;
					break;
				case "tool": {
					closeInlineStreamIfNeeded();
					const toolName = event.toolName ?? "unknown_tool";
					const inputStr = formatToolInput(toolName, event.input);
					write(
						`\n${c.dim}[${toolName}]${c.reset} ${c.cyan}${inputStr}${c.reset}`,
					);
					break;
				}
			}
			break;

		case "content_end":
			switch (event.contentType) {
				case "text":
				case "reasoning":
					closeInlineStreamIfNeeded();
					break;
				case "tool":
					closeInlineStreamIfNeeded();
					if (event.error) {
						write(` ${c.red}error: ${event.error}${c.reset}\n`);
					} else {
						const outputStr = formatToolOutput(event.output);
						if (outputStr) {
							write(`  ${c.dim}-> ${outputStr}${c.reset}\n`);
						} else {
							write(` ${c.green}ok${c.reset}\n`);
						}
					}
					break;
			}
			break;

		case "done":
			closeInlineStreamIfNeeded();
			write(
				`\n${c.dim}── finished: ${event.reason} (${event.iterations} iterations) ──${c.reset}\n`,
			);
			activeInlineStream = undefined;
			inlineStreamHasOutput = false;
			break;

		case "error":
			closeInlineStreamIfNeeded();
			writeErr(event.error.message);
			break;
	}
}

// =============================================================================
// Team event handler
// =============================================================================

export function handleTeamEvent(event: TeamEvent): void {
	if (getCurrentOutputMode() === "json") {
		emitJsonLine("stdout", { type: "team_event", event });
		return;
	}

	switch (event.type) {
		case "teammate_spawned":
			write(
				`\n${c.dim}[team] teammate spawned:${c.reset} ${c.cyan}${event.agentId}${c.reset}`,
			);
			break;
		case "teammate_shutdown":
			write(
				`\n${c.dim}[team] teammate shutdown:${c.reset} ${c.cyan}${event.agentId}${c.reset}`,
			);
			break;
		case "team_task_updated":
			write(
				`\n${c.dim}[team task]${c.reset} ${c.cyan}${event.task.id}${c.reset} -> ${event.task.status}`,
			);
			break;
		case "team_message":
			write(
				`\n${c.dim}[mailbox]${c.reset} ${event.message.fromAgentId} -> ${event.message.toAgentId}: ${event.message.subject}`,
			);
			break;
		case "team_mission_log":
			write(
				`\n${c.dim}[mission]${c.reset} ${event.entry.agentId}: ${truncate(event.entry.summary, 90)}`,
			);
			break;
		case "task_start":
			break;
		case "task_end":
			break;
		case "agent_event":
			break;
	}
}
