import { afterEach, describe, expect, it, vi } from "vitest";
import { runScheduleCommand } from "./schedule";

const mockListSchedules = vi.hoisted(() => vi.fn());
const mockClientClose = vi.hoisted(() => vi.fn());
const mockGetRpcServerHealth = vi.hoisted(() => vi.fn());

vi.mock("@clinebot/rpc", () => ({
	getRpcServerHealth: mockGetRpcServerHealth,
	RpcSessionClient: class {
		async listSchedules(input: unknown) {
			return mockListSchedules(input);
		}

		close() {
			mockClientClose();
		}
	},
}));

vi.mock("./rpc", () => ({
	runRpcEnsureCommand: vi.fn(async () => 0),
}));

describe("runScheduleCommand list output", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it('prints "No schedules found." for empty non-json list output', async () => {
		mockGetRpcServerHealth.mockResolvedValue({ running: true });
		mockListSchedules.mockResolvedValue([]);

		const output: string[] = [];
		const errors: string[] = [];
		const code = await runScheduleCommand(["schedule", "list"], {
			writeln: (text) => {
				output.push(text ?? "");
			},
			writeErr: (text) => {
				errors.push(text);
			},
		});

		expect(code).toBe(0);
		expect(errors).toEqual([]);
		expect(output).toEqual(["No schedules found."]);
		expect(mockListSchedules).toHaveBeenCalledWith({
			limit: 100,
			enabled: undefined,
			tags: undefined,
		});
		expect(mockClientClose).toHaveBeenCalledTimes(1);
	});

	it("keeps JSON list output unchanged when --json is provided", async () => {
		mockGetRpcServerHealth.mockResolvedValue({ running: true });
		mockListSchedules.mockResolvedValue([]);

		const output: string[] = [];
		const errors: string[] = [];
		const code = await runScheduleCommand(["schedule", "list", "--json"], {
			writeln: (text) => {
				output.push(text ?? "");
			},
			writeErr: (text) => {
				errors.push(text);
			},
		});

		expect(code).toBe(0);
		expect(errors).toEqual([]);
		expect(output).toEqual(["[]"]);
		expect(mockClientClose).toHaveBeenCalledTimes(1);
	});
});
