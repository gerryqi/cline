import { ClineAccountService } from "@cline/core/server";
import type { providers } from "@cline/llms";
import { formatCreditBalance, normalizeCreditBalance } from "../utils/output";
import type { Config } from "../utils/types";

export async function resolveClineWelcomeLine(input: {
	config: Config;
	clineApiBaseUrl?: string;
	clineProviderSettings?: providers.ProviderSettings;
}): Promise<string | undefined> {
	if (input.config.providerId !== "cline") {
		return undefined;
	}
	const persistedAccessToken =
		input.clineProviderSettings?.auth?.accessToken?.trim() || "";
	const configApiKey = input.config.apiKey.trim();
	let authToken = persistedAccessToken || configApiKey;
	if (authToken.startsWith("workos:workos:")) {
		authToken = authToken.slice("workos:".length);
	}
	if (!authToken) {
		return undefined;
	}

	const service = new ClineAccountService({
		apiBaseUrl: input.clineApiBaseUrl?.trim() || "https://api.cline.bot",
		getAuthToken: async () => authToken,
	});
	try {
		const me = await service.fetchMe();
		const activeOrgName = me.organizations
			.find((org) => org.active)
			?.name?.trim();
		const activeOrganizationId = me.organizations.find(
			(org) => org.active,
		)?.organizationId;
		let rawBalance: number;
		if (activeOrganizationId?.trim()) {
			const orgBalance =
				await service.fetchOrganizationBalance(activeOrganizationId);
			rawBalance = orgBalance.balance;
		} else {
			const userBalance = await service.fetchBalance(me.id);
			rawBalance = userBalance.balance;
		}
		const normalizedBalance = normalizeCreditBalance(rawBalance);
		const parts = [
			me.email,
			`Credits: ${formatCreditBalance(normalizedBalance)}`,
		];
		if (activeOrgName) {
			parts.push(activeOrgName);
		}
		return parts.join(" | ");
	} catch {
		return undefined;
	}
}
