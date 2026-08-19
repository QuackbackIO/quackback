/**
 * Preview harness (AI-ATTRIBUTES-PARITY-SPEC.md Phase 3): "test detection"
 * against a sample customer message, from inside the attribute editor,
 * BEFORE the definition is even saved. Runs the exact same
 * `classification-core.ts` call the real classifier
 * (`ai-classification.service.ts`) uses, over an EPHEMERAL one-line
 * transcript containing just the sample message — so the predicted
 * option + reasoning shown to the admin is provably what Quinn would decide
 * on a real conversation whose only customer content was that sample.
 *
 * Unlike the fire-and-forget real classifier (which never throws — it's
 * invoked from best-effort background moments), this is a foreground,
 * admin-invoked action: gating failures and call failures propagate as
 * thrown errors so the editor can surface them (toast), rather than
 * silently returning an empty/null result.
 */
import { config } from '@/lib/server/config'
import { isAiClientConfigured } from '@/lib/server/domains/ai/config'
import { getChatModel } from '@/lib/server/domains/ai/models'
import { enforceAiTokenBudget } from '@/lib/server/domains/settings/tier-enforce'
import { isFeatureEnabled } from '@/lib/server/domains/settings/settings.service'
import { ValidationError } from '@/lib/shared/errors'
import {
  runClassificationCall,
  TRANSCRIPT_CHAR_BUDGET,
  type ClassificationDefinitionInput,
} from './classification-core'

/** The draft definition shape the editor can preview — may be UNSAVED (no
 *  persisted id/key yet), so every option needs SOME id even if it hasn't
 *  been minted server-side (the fn layer fills a positional placeholder for
 *  brand-new options; see conversation-attributes.ts). */
export interface PreviewAttributeDefinitionInput {
  key?: string
  label: string
  description?: string | null
  options: { id: string; label: string; description?: string | null }[]
}

export interface PreviewAttributeDetectionInput {
  definition: PreviewAttributeDefinitionInput
  sampleMessage: string
}

export interface PreviewAttributeDetectionResult {
  optionId: string | null
  optionLabel: string | null
  reasoning: string
}

/** Key used for the classification call when the definition being previewed
 *  hasn't been saved yet (so it has no real key). Never persisted. */
const EPHEMERAL_PREVIEW_KEY = 'preview_attribute'

export async function previewAttributeDetection(
  input: PreviewAttributeDetectionInput
): Promise<PreviewAttributeDetectionResult> {
  if (!(await isFeatureEnabled('inboxAi'))) {
    throw new ValidationError(
      'AI_ATTRIBUTE_DETECTION_DISABLED',
      'AI attribute detection is turned off'
    )
  }
  const model = getChatModel('classification')
  if (!isAiClientConfigured(config.openaiApiKey, config.openaiBaseUrl) || !model) {
    throw new ValidationError('AI_NOT_CONFIGURED', 'AI is not configured')
  }
  // Propagates TierLimitError as-is (the caller/UI surfaces its message).
  await enforceAiTokenBudget()

  const sample = input.sampleMessage.trim()
  if (!sample) {
    throw new ValidationError('VALIDATION_ERROR', 'Sample message is required')
  }
  if (input.definition.options.length === 0) {
    throw new ValidationError(
      'VALIDATION_ERROR',
      'Add at least one option before testing detection'
    )
  }

  const truncatedSample =
    sample.length > TRANSCRIPT_CHAR_BUDGET
      ? sample.slice(0, TRANSCRIPT_CHAR_BUDGET) + '\n\n[truncated]'
      : sample
  const transcript = `Customer: ${truncatedSample}`

  const key = input.definition.key?.trim() || EPHEMERAL_PREVIEW_KEY
  const def: ClassificationDefinitionInput = {
    key,
    label: input.definition.label,
    description: input.definition.description ?? null,
    options: input.definition.options.map((o) => ({
      id: o.id,
      label: o.label,
      description: o.description ?? null,
    })),
  }

  const results = await runClassificationCall({
    model,
    definitions: [def],
    transcript,
    usageMetadata: { pipelineContext: 'attribute_preview', key },
  })

  const result = results.find((r) => r.key === key)
  if (!result) {
    return { optionId: null, optionLabel: null, reasoning: 'The model returned no usable result.' }
  }
  const optionLabel = result.optionId
    ? (def.options.find((o) => o.id === result.optionId)?.label ?? null)
    : null
  return { optionId: result.optionId, optionLabel, reasoning: result.reasoning }
}
