/**
 * "Draft descriptions" authoring assist (AI-ATTRIBUTES-PARITY-SPEC.md Phase
 * 3): one chat call that turns an attribute label + its option labels into
 * applies-if/does-not-apply-if/likely-phrasing descriptions — the exact
 * template both Intercom's and Featurebase's authoring docs tell admins to
 * write themselves with an external LLM (AI-ATTRIBUTES-PARITY-SPEC.md §1's
 * "Authoring guidance" row). Building it in turns a documented manual
 * workaround into a button.
 *
 * Reuses the same flag/config/budget gate and `classification` chat model as
 * the real classifier and the preview harness — this is authoring tooling
 * for the same feature area, not a separate AI surface with its own dial.
 * Not part of `classification-core.ts`: the request/response shape here
 * (attribute + option descriptions) is unrelated to classifying a
 * transcript, so sharing would only entangle two different prompts.
 *
 * Like the preview harness (and unlike the fire-and-forget real classifier),
 * this is a foreground, admin-invoked action — gating and parsing failures
 * are thrown, not swallowed, so the editor can surface them.
 */
import { chat } from '@tanstack/ai'
import { openaiCompatibleText } from '@tanstack/ai-openai/compatible'
import { z } from 'zod'
import { config } from '@/lib/server/config'
import {
  isAiClientConfigured,
  structuredOutputProviderOptions,
} from '@/lib/server/domains/ai/config'
import { createUsageLoggingMiddleware } from '@/lib/server/domains/ai/usage-middleware'
import { getChatModel } from '@/lib/server/domains/ai/models'
import { enforceAiTokenBudget } from '@/lib/server/domains/settings/tier-enforce'
import { isFeatureEnabled } from '@/lib/server/domains/settings/settings.service'
import { ValidationError } from '@/lib/shared/errors'

const DRAFT_SYSTEM_PROMPT = `You help an admin write descriptions for a customer-support conversation attribute that an AI classifier will use to categorize conversations.

Write ONE short description for the attribute itself, explaining what it captures.
For EACH option, write a short description following this template: when it applies, when it does NOT apply, and 1-2 phrases a customer might typically use that indicate it. Keep each description under 300 characters.

Respond with ONLY a single JSON object of this exact shape, and nothing else: {"attributeDescription": string, "options": [{"label": string, "description": string}]}. Include exactly one entry per option label given, using the exact label text given, in any order.

Example output:
{
  "attributeDescription": "The area of the product the conversation is about.",
  "options": [
    {"label": "Billing", "description": "Applies to invoices, charges, refunds, or plan changes. Does NOT apply to questions about product features. Typical phrases: \\"I was charged twice\\", \\"update my card\\"."}
  ]
}`

export interface DraftAttributeDescriptionsInput {
  label: string
  optionLabels: string[]
}

export interface DraftAttributeDescriptionsResult {
  attributeDescription: string
  options: { label: string; description: string }[]
}

/**
 * Deliberately PERMISSIVE at the field level: a wrong-typed
 * `attributeDescription` or option `label`/`description` degrades that one
 * field to `undefined` via `.catch` rather than failing the whole response,
 * mirroring the old hand-parser's per-field `typeof` guards. `options`
 * itself is NOT given a `.catch` fallback at the array level — if it's
 * missing or not an array at all, the outer object's `.catch` kicks in with
 * `options: undefined`, which `draftAttributeDescriptions` below detects and
 * turns into the same `VALIDATION_ERROR` the old `Array.isArray` check
 * threw. A genuine call failure (network, provider error) still rejects the
 * `chat()` call itself and is not caught here.
 */
const DraftDescriptionsSchema = z
  .object({
    attributeDescription: z.string().optional().catch(undefined),
    options: z
      .array(
        z.object({
          label: z.string().optional().catch(undefined),
          description: z.string().optional().catch(undefined),
        })
      )
      .optional(),
  })
  .catch({ options: undefined })

export async function draftAttributeDescriptions(
  input: DraftAttributeDescriptionsInput
): Promise<DraftAttributeDescriptionsResult> {
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
  await enforceAiTokenBudget()

  const label = input.label.trim()
  const optionLabels = input.optionLabels.map((l) => l.trim()).filter(Boolean)
  if (!label) throw new ValidationError('VALIDATION_ERROR', 'Attribute label is required')
  if (optionLabels.length === 0) {
    throw new ValidationError('VALIDATION_ERROR', 'At least one option label is required')
  }

  const userContent = [
    `Attribute label: ${label}`,
    'Option labels:',
    ...optionLabels.map((l) => `- ${l}`),
  ].join('\n')

  const object = await chat({
    adapter: openaiCompatibleText(model, {
      baseURL: config.openaiBaseUrl!,
      apiKey: config.openaiApiKey!,
    }),
    systemPrompts: [DRAFT_SYSTEM_PROMPT],
    messages: [{ role: 'user', content: userContent }],
    outputSchema: DraftDescriptionsSchema,
    stream: false,
    modelOptions: { max_tokens: 1500, ...structuredOutputProviderOptions() },
    middleware: [
      createUsageLoggingMiddleware({
        pipelineStep: 'classification',
        model,
        metadata: { pipelineContext: 'attribute_description_draft' },
      }),
    ],
  })

  if (!object.options) {
    throw new ValidationError('VALIDATION_ERROR', 'The model returned an unexpected response shape')
  }

  const attributeDescription = object.attributeDescription?.trim() ?? ''

  const byLabel = new Map<string, string>()
  for (const raw of object.options) {
    if (typeof raw.label !== 'string') continue
    byLabel.set(raw.label, typeof raw.description === 'string' ? raw.description.trim() : '')
  }

  // Re-ordered (and re-keyed) to match the caller's INPUT order — the model's
  // response order/labels are not trusted verbatim, mirroring the real
  // classifier's key-matching-against-the-known-set discipline.
  const options = optionLabels.map((optLabel) => ({
    label: optLabel,
    description: byLabel.get(optLabel) ?? '',
  }))

  return { attributeDescription, options }
}
