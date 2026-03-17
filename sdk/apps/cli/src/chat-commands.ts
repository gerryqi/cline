import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { resolveWorkspaceRoot } from "./utils/helpers";

export type ChatCommandState = {
	enableTools: boolean;
	autoApproveTools: boolean;
	cwd: string;
	workspaceRoot: string;
};

export type ChatCommandContext = {
	enabled: boolean;
	getState: () => Promise<ChatCommandState> | ChatCommandState;
	setState: (next: ChatCommandState) => Promise<void> | void;
	reply: (text: string) => Promise<void> | void;
	reset?: () => Promise<void> | void;
	stop?: () => Promise<void> | void;
	describe?: () => Promise<string> | string;
};

function parseBooleanValue(
	value: string | undefined,
	current: boolean,
): boolean | undefined {
	const normalized = value?.trim().toLowerCase();
	if (!normalized) {
		return undefined;
	}
	if (normalized === "on" || normalized === "true" || normalized === "1") {
		return true;
	}
	if (normalized === "off" || normalized === "false" || normalized === "0") {
		return false;
	}
	if (normalized === "toggle") {
		return !current;
	}
	return undefined;
}

function usage(text: string): string {
	return `Usage: ${text}`;
}

export async function maybeHandleChatCommand(
	input: string,
	context: ChatCommandContext,
): Promise<boolean> {
	if (!context.enabled) {
		return false;
	}

	const trimmed = input.trim();
	if (!trimmed.startsWith("/")) {
		return false;
	}

	const [commandRaw, ...args] = trimmed.split(/\s+/);
	const command = commandRaw.toLowerCase();
	const state = await context.getState();

	if (command === "/reset") {
		if (!context.reset) {
			return false;
		}
		await context.reset();
		await context.reply("Started a fresh session.");
		return true;
	}

	if (command === "/stop") {
		if (!context.stop) {
			return false;
		}
		await context.reply("Stopping session.");
		await context.stop();
		return true;
	}

	if (command === "/whereami") {
		if (!context.describe) {
			return false;
		}
		await context.reply(await context.describe());
		return true;
	}

	if (command === "/tools") {
		const resolved = parseBooleanValue(args[0], state.enableTools);
		if (args[0] && resolved === undefined) {
			await context.reply(usage("/tools [on|off|toggle]"));
			return true;
		}
		if (resolved === undefined) {
			await context.reply(`tools=${state.enableTools ? "on" : "off"}`);
			return true;
		}
		await context.setState({ ...state, enableTools: resolved });
		await context.reply(`tools=${resolved ? "on" : "off"}`);
		return true;
	}

	if (command === "/yolo") {
		const resolved = parseBooleanValue(args[0], state.autoApproveTools);
		if (args[0] && resolved === undefined) {
			await context.reply(usage("/yolo [on|off|toggle]"));
			return true;
		}
		if (resolved === undefined) {
			await context.reply(`yolo=${state.autoApproveTools ? "on" : "off"}`);
			return true;
		}
		await context.setState({ ...state, autoApproveTools: resolved });
		await context.reply(`yolo=${resolved ? "on" : "off"}`);
		return true;
	}

	if (command === "/cwd") {
		const rawPath = args.join(" ").trim();
		if (!rawPath) {
			await context.reply(
				`cwd=${state.cwd}\nworkspaceRoot=${state.workspaceRoot}`,
			);
			return true;
		}
		const nextCwd = resolve(state.cwd, rawPath);
		const fileStat = await stat(nextCwd).catch(() => undefined);
		if (!fileStat?.isDirectory()) {
			await context.reply(`invalid directory: ${nextCwd}`);
			return true;
		}
		const workspaceRoot = resolveWorkspaceRoot(nextCwd);
		await context.setState({
			...state,
			cwd: nextCwd,
			workspaceRoot,
		});
		await context.reply(`cwd=${nextCwd}\nworkspaceRoot=${workspaceRoot}`);
		return true;
	}

	return false;
}
