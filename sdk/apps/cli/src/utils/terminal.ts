const TERMINAL_RESET_SEQUENCE =
	"\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?1015l\x1b[?25h\x1b[?2026l";

export function resetTerminalState(): void {
	if (!process.stdout.isTTY) {
		return;
	}
	try {
		process.stdout.write(TERMINAL_RESET_SEQUENCE);
	} catch {
		// best effort
	}
}
