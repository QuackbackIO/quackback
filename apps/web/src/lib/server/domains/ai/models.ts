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
  | 'helpCenterAnswers'
  | 'helpCenterTranslate'
  // The in-product AI agent (Quinn). No per-feature model override today: it
  // rides the chat role default so BYOK config stays one dial.
  | 'assistant'
  // Two-way inbox translation (P2-D.1): customer-language detection plus the
  // incoming/outgoing translate calls all ride this one feature dial.
  | 'inboxTranslation'
  // Deterministic conversation attribute classification (AI-ATTRIBUTES-PARITY-SPEC.md
  // Phase 1): one structured-output call per classification moment, over all
  // ai_detect=true attributes for a conversation.
  | 'classification'

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
    helpCenterAnswers: config.aiHelpCenterModel,
    helpCenterTranslate: config.aiHelpCenterTranslateModel,
    assistant: config.aiAssistantModel,
    inboxTranslation: config.aiInboxTranslationModel,
    classification: config.aiClassificationModel,
  }
  return resolveModel(overrides[feature], config.aiChatModel)
}

/** Effective embedding model, or null when embeddings are disabled. */
export function getEmbeddingModel(): string | null {
  return resolveModel(undefined, config.aiEmbeddingModel)
}

/**
 * Vision gate: whether a chat model accepts image input. BYOK config is an
 * opaque model string against an OpenAI-compatible endpoint — there is no
 * provider handshake to query — so capability is a curated name-pattern list
 * of the mainstream vision-capable families, with `AI_ASSISTANT_VISION=on|off`
 * as the explicit override for proxied or renamed deployments the patterns
 * can't see. Callers must treat false as "never stream an image part": a
 * text-only endpoint rejects or silently drops them.
 */
const VISION_MODEL_PATTERNS: RegExp[] = [
  /\bgpt-4o\b/,
  /\bgpt-4\.1/,
  /\bgpt-4[-.]?(turbo|vision)\b/,
  /\bgpt-5/,
  /\bchatgpt-4o/,
  /\bo[134](-mini|-pro)?\b/,
  /claude[-\w]*(3|4|opus|sonnet|haiku)/,
  /\bgemini-(1\.5|2|3)/,
  /\bvision\b/,
  /\bllava\b/,
  /\bpixtral\b/,
  /\bministral\b/,
  /[-_]vl([-.]|\b)/,
]

export function isVisionCapableModel(model: string | null): boolean {
  const override = config.aiAssistantVision?.trim().toLowerCase()
  if (override === 'on' || override === 'true') return true
  if (override === 'off' || override === 'false') return false
  if (!model) return false
  const normalized = model.toLowerCase()
  return VISION_MODEL_PATTERNS.some((pattern) => pattern.test(normalized))
}
