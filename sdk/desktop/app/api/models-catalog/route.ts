import {
	ANTHROPIC_MODELS,
	CLINE_MODELS,
	GEMINI_MODELS,
	OPENAI_MODELS,
} from "@cline/llms/models";
import { getLiveModelsCatalog } from "@cline/llms/providers";
import { NextResponse } from "next/server";

export const dynamic = "force-static";

const FALLBACK_PROVIDER_MODELS: Record<string, string[]> = {
	cline: ["anthropic/claude-sonnet-4.6"],
	anthropic: ["claude-sonnet-4-6"],
	openai: ["gpt-5.3-codex"],
	openrouter: ["anthropic/claude-sonnet-4.6"],
	gemini: ["gemini-2.5-pro"],
};

const FALLBACK_PROVIDER_REASONING_MODELS: Record<string, string[]> = {
	cline: ["anthropic/claude-sonnet-4.6"],
	anthropic: ["claude-sonnet-4-6"],
	openai: ["gpt-5.3-codex"],
	openrouter: ["anthropic/claude-sonnet-4.6"],
	gemini: ["gemini-2.5-pro"],
};

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

export async function GET() {
	const providerModels: Record<string, string[]> = {
		cline: uniqueSorted([
			...toModelIds(CLINE_MODELS),
			...FALLBACK_PROVIDER_MODELS.cline,
		]),
		anthropic: uniqueSorted([
			...toModelIds(ANTHROPIC_MODELS),
			...FALLBACK_PROVIDER_MODELS.anthropic,
		]),
		openai: uniqueSorted([
			...toModelIds(OPENAI_MODELS),
			...FALLBACK_PROVIDER_MODELS.openai,
		]),
		openrouter: uniqueSorted(FALLBACK_PROVIDER_MODELS.openrouter),
		gemini: uniqueSorted([
			...toModelIds(GEMINI_MODELS),
			...FALLBACK_PROVIDER_MODELS.gemini,
		]),
	};
	const providerReasoningModels: Record<string, string[]> = {
		cline: uniqueSorted([
			...toReasoningModelIds(CLINE_MODELS),
			...FALLBACK_PROVIDER_REASONING_MODELS.cline,
		]),
		anthropic: uniqueSorted([
			...toReasoningModelIds(ANTHROPIC_MODELS),
			...FALLBACK_PROVIDER_REASONING_MODELS.anthropic,
		]),
		openai: uniqueSorted([
			...toReasoningModelIds(OPENAI_MODELS),
			...FALLBACK_PROVIDER_REASONING_MODELS.openai,
		]),
		openrouter: uniqueSorted(FALLBACK_PROVIDER_REASONING_MODELS.openrouter),
		gemini: uniqueSorted([
			...toReasoningModelIds(GEMINI_MODELS),
			...FALLBACK_PROVIDER_REASONING_MODELS.gemini,
		]),
	};

	try {
		const liveCatalog = await getLiveModelsCatalog();
		for (const [providerId, models] of Object.entries(liveCatalog)) {
			const modelIds = toModelIds(models as Record<string, unknown>);
			const reasoningModelIds = toReasoningModelIds(
				models as Record<string, unknown>,
			);
			if (modelIds.length === 0) {
				continue;
			}
			if (providerId === "vercel-ai-gateway" || providerId === "cline") {
				providerModels.cline = uniqueSorted([
					...(providerModels.cline ?? []),
					...modelIds,
				]);
				providerReasoningModels.cline = uniqueSorted([
					...(providerReasoningModels.cline ?? []),
					...reasoningModelIds,
				]);
				continue;
			}
			if (providerId === "openai-native") {
				providerModels.openai = uniqueSorted([
					...(providerModels.openai ?? []),
					...modelIds,
				]);
				providerReasoningModels.openai = uniqueSorted([
					...(providerReasoningModels.openai ?? []),
					...reasoningModelIds,
				]);
				continue;
			}
			if (!providerModels[providerId]) {
				continue;
			}
			providerModels[providerId] = uniqueSorted([
				...(providerModels[providerId] ?? []),
				...modelIds,
			]);
			providerReasoningModels[providerId] = uniqueSorted([
				...(providerReasoningModels[providerId] ?? []),
				...reasoningModelIds,
			]);
		}
	} catch {
		// Return fallback/static models when live catalog cannot be fetched.
	}

	return NextResponse.json({ providerModels, providerReasoningModels });
}
