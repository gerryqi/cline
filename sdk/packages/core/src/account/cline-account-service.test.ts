import { describe, expect, it, vi } from "vitest";
import { ClineAccountService } from "./cline-account-service";

describe("ClineAccountService", () => {
	it("fetches current user balance and sends auth header", async () => {
		const fetchImpl = vi.fn(async (input: unknown, init?: RequestInit) => {
			expect(String(input)).toBe(
				"https://api.cline.bot/api/v1/users/user-1/balance",
			);
			expect(init?.headers).toMatchObject({
				Authorization: "Bearer workos:token-123",
			});
			return new Response(
				JSON.stringify({
					success: true,
					data: { balance: 5, userId: "user-1" },
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		});

		const service = new ClineAccountService({
			apiBaseUrl: "https://api.cline.bot",
			getAuthToken: async () => "workos:token-123",
			getCurrentUserId: () => "user-1",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});

		const balance = await service.fetchBalance();
		expect(balance).toEqual({ balance: 5, userId: "user-1" });
	});

	it("resolves organization member id from /users/me when not provided", async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						success: true,
						data: {
							id: "u-1",
							email: "u@example.com",
							displayName: "User",
							photoUrl: "",
							createdAt: "2025-01-01T00:00:00Z",
							updatedAt: "2025-01-01T00:00:00Z",
							organizations: [
								{
									active: true,
									memberId: "member-9",
									name: "Org",
									organizationId: "org-1",
									roles: ["member"],
								},
							],
						},
					}),
					{ status: 200 },
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({ success: true, data: { items: [{ id: "tx-1" }] } }),
					{ status: 200 },
				),
			);

		const service = new ClineAccountService({
			apiBaseUrl: "https://api.cline.bot",
			getAuthToken: async () => "workos:token-123",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});

		const transactions = await service.fetchOrganizationUsageTransactions({
			organizationId: "org-1",
		});

		expect(fetchImpl).toHaveBeenCalledTimes(2);
		expect(String(fetchImpl.mock.calls[1][0])).toBe(
			"https://api.cline.bot/api/v1/organizations/org-1/members/member-9/usages",
		);
		expect(transactions).toEqual([{ id: "tx-1" }]);
	});

	it("switchAccount sends null org id for personal account", async () => {
		const fetchImpl = vi.fn(async (_input: unknown, init?: RequestInit) => {
			expect(init?.method).toBe("PUT");
			expect(init?.body).toBe(JSON.stringify({ organizationId: null }));
			return new Response(null, { status: 204 });
		});

		const service = new ClineAccountService({
			apiBaseUrl: "https://api.cline.bot",
			getAuthToken: async () => "workos:token-123",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});

		await service.switchAccount(undefined);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});
});
