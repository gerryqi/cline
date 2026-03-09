import { describe, expect, it } from "vitest";
import type { ApiStream, ProviderConfig } from "../types/index";
import { BaseHandler } from "./base";

class TestHandler extends BaseHandler {
	getMessages(): unknown {
		return [];
	}

	createMessage(): ApiStream {
		throw new Error("not implemented");
	}

	public computeCost(
		inputTokens: number,
		outputTokens: number,
		cacheReadTokens = 0,
	): number | undefined {
		return this.calculateCost(inputTokens, outputTokens, cacheReadTokens);
	}
}

describe("BaseHandler.calculateCost", () => {
	it("uses known model pricing when modelInfo is not provided", () => {
		const config: ProviderConfig = {
			providerId: "anthropic",
			modelId: "claude-sonnet-test",
			apiKey: "test-key",
			knownModels: {
				"claude-sonnet-test": {
					id: "claude-sonnet-test",
					pricing: {
						input: 3,
						output: 15,
						cacheRead: 0.3,
					},
				},
			},
		};
		const handler = new TestHandler(config);

		const cost = handler.computeCost(1_000_000, 1_000_000, 100_000);

		expect(cost).toBeCloseTo(17.73, 6);
	});
});
