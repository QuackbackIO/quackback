/**
 * AI model resolution.
 *
 * Models are configured per-role (chat, embedding) with optional per-feature
 * overrides. An override of "off" / "none" / "false" disables that feature
 * even when the role default is set. An unset role default means that
 * capability is off — there is no built-in default model and no implied
 * provider. See #180 for why a missing/invalid default must mean "disabled".
 */

import { config } from '@/lib/server/config'

const DISABLED_VALUES = new Set(['off', 'none', 'false'])

export type ChatFeature =
  | 'summary'
  | 'sentiment'
  | 'extraction'
  | 'qualityGate'
  | 'interpretation'
  | 'merge'

/**
 * Resolve an effective model: per-feature override wins over the role default;
 * a disable sentinel or a fully-unset config yields null (feature disabled).
 */
export function resolveModel(
  override: string | undefined,
  roleDefault: string | undefined
): string | null {
  // Per-feature override wins over the role default. The disable sentinel and
  // trimming apply to whichever value is effective — so AI_CHAT_MODEL=off (a
  // role default) and AI_EMBEDDING_MODEL=off both disable, not just per-feature
  // overrides.
  const effective = override ?? roleDefault
  if (effective === undefined) return null
  const trimmed = effective.trim()
  return DISABLED_VALUES.has(trimmed.toLowerCase()) ? null : trimmed
}

/** Effective chat model for a feature, or null when the feature is disabled. */
export function getChatModel(feature: ChatFeature): string | null {
  const overrides: Record<ChatFeature, string | undefined> = {
    summary: config.aiSummaryModel,
    sentiment: config.aiSentimentModel,
    extraction: config.aiExtractionModel,
    qualityGate: config.aiQualityGateModel,
    interpretation: config.aiInterpretationModel,
    merge: config.aiMergeModel,
  }
  return resolveModel(overrides[feature], config.aiChatModel)
}

/** Effective embedding model, or null when embeddings are disabled. */
export function getEmbeddingModel(): string | null {
  return resolveModel(undefined, config.aiEmbeddingModel)
}
