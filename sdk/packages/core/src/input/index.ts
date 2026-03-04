export type { FastFileIndexOptions } from "@cline/shared";
export { getFileIndex, prewarmFileIndex } from "@cline/shared";
export type {
	MentionEnricherOptions,
	MentionEnrichmentResult,
} from "./mention-enricher";
export { enrichPromptWithMentions } from "./mention-enricher";
