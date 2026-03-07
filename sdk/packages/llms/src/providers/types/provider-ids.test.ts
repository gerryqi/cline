import { describe, expect, it } from "vitest";
import { getProviderIds } from "../../models/registry.js";
import { BUILT_IN_PROVIDER_IDS } from "./provider-ids.js";

describe("provider-ids", () => {
	it("keeps built-in provider ids aligned with model registry loaders", () => {
		const registryProviderIds = new Set(getProviderIds());
		for (const providerId of BUILT_IN_PROVIDER_IDS) {
			expect(registryProviderIds.has(providerId)).toBe(true);
		}
	});
});
