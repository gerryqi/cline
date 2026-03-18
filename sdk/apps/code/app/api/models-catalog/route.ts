import { models } from "@clinebot/llms";
import { NextResponse } from "next/server";

export const dynamic = "force-static";

const SUPPORTED_PROVIDER_IDS = [
	"cline",
	"anthropic",
	"openai",
	"openrouter",
	"gemini",
] as const;
type SupportedProviderId = (typeof SUPPORTED_PROVIDER_IDS)[number];

function toReasoningModelIds(
	models: Record<string, unknown> | undefined,
): string[] {
	if (!models) {
		return [];
	}
	return Object.entries(models)
		.filter(([, info]) => {
			if (!info || typeof info !== "object") {
				return false;
			}
			const modelInfo = info as {
				capabilities?: unknown;
				thinkingConfig?: unknown;
			};
			if (
				Array.isArray(modelInfo.capabilities) &&
				modelInfo.capabilities.includes("reasoning")
			) {
				return true;
			}
			return modelInfo.thinkingConfig != null;
		})
		.map(([modelId]) => modelId);
}

function toModelIds(models: Record<string, unknown> | undefined): string[] {
	if (!models) {
		return [];
	}
	return Object.keys(models);
}

function uniqueSorted(values: string[]): string[] {
	return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function buildProviderModels(
	providerIds: SupportedProviderId[],
): Record<string, string[]> {
	const staticProviderModels: Record<
		SupportedProviderId,
		Record<string, unknown>
	> = {
		cline: models.CLINE_MODELS,
		anthropic: models.ANTHROPIC_MODELS,
		openai: models.OPENAI_MODELS,
		openrouter: models.OPENROUTER_MODELS,
		gemini: models.GEMINI_MODELS,
	};
	return Object.fromEntries(
		providerIds.map((providerId) => [
			providerId,
			uniqueSorted([...toModelIds(staticProviderModels[providerId])]),
		]),
	);
}

function buildReasoningProviderModels(
	providerIds: SupportedProviderId[],
): Record<string, string[]> {
	const staticProviderModels: Record<
		SupportedProviderId,
		Record<string, unknown>
	> = {
		cline: models.CLINE_MODELS,
		anthropic: models.ANTHROPIC_MODELS,
		openai: models.OPENAI_MODELS,
		openrouter: models.OPENROUTER_MODELS,
		gemini: models.GEMINI_MODELS,
	};
	return Object.fromEntries(
		providerIds.map((providerId) => [
			providerId,
			uniqueSorted([...toReasoningModelIds(staticProviderModels[providerId])]),
		]),
	);
}

export async function GET(_request: Request) {
	const providerIds = [...SUPPORTED_PROVIDER_IDS];

	const providerModels = buildProviderModels(providerIds);
	const providerReasoningModels = buildReasoningProviderModels(providerIds);

	return NextResponse.json({ providerModels, providerReasoningModels });
}
