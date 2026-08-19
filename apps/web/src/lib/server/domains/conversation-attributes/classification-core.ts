/**
 * Shared classification core (AI-ATTRIBUTES-PARITY-SPEC.md Phase 3): the one
 * structured-output model call + response parsing/validation used by BOTH the
 * real classifier (`ai-classification.service.ts`'s
 * `classifyConversationAttributes`) and the preview harness
 * (`attribute-preview.service.ts`'s `previewAttributeDetection`). Extracted so
 * a preview result is provably what the real classifier would decide — same
 * system prompt, same request shape, same option-id validation — rather than
 * a second, potentially-drifting prompt.
 *
 * Deliberately does NOT gate on the feature flag, AI configuration, or the
 * token budget: callers gate first (their gates differ slightly — the real
 * classifier also narrows by trigger/detectOnClose and no-ops on an empty
 * catalogue; preview always classifies exactly one, possibly-unsaved
 * definition) and only reach here once they're committed to spending a call.
 */
import { chat } from '@tanstack/ai'
import { openaiCompatibleText } from '@tanstack/ai-openai/compatible'
import { z } from 'zod'
import { config } from '@/lib/server/config'
import { structuredOutputProviderOptions } from '@/lib/server/domains/ai/config'
import { createUsageLoggingMiddleware } from '@/lib/server/domains/ai/usage-middleware'

/**
 * Bounds any transcript handed to the classifier call, real conversation or
 * ephemeral preview sample alike — keeps the prompt (and the worst case
 * token spend) bounded regardless of caller.
 */
export const TRANSCRIPT_CHAR_BUDGET = 3000

export const CLASSIFICATION_SYSTEM_PROMPT = `You are a classification engine for a customer support conversation.

You will be given a list of attribute definitions (each with a key, a label, a description, and its allowed options with an id/label/description) and the conversation transcript. For EACH attribute in the list, decide which option (if any) applies, based only on the transcript.

Rules:
- Refer to an option by its id, never its label.
- If nothing in the transcript clearly supports one option over the others for an attribute, set "optionId" to null. Do not guess.
- Base your decision only on the transcript given; never invent facts not present in it.
- Give one short sentence of reasoning per attribute, naming what in the transcript supports (or fails to support) your decision.
- Include exactly one result per attribute key you were given, in any order.

Respond with ONLY a single JSON object of this exact shape, and nothing else: {"results": [{"key": string, "optionId": string | null, "reasoning": string}]}

Example output (keys and option ids copied verbatim from the supplied definitions):
{
  "results": [
    {"key": "issue_type", "optionId": "opt_billing", "reasoning": "The customer reports a double charge on their invoice."},
    {"key": "urgency", "optionId": null, "reasoning": "Nothing in the transcript indicates how time-sensitive this is."}
  ]
}`

export interface ClassificationOptionInput {
  id: string
  label: string
  description: string | null
}

/** The definition shape the classification core needs — a structural subset
 *  both `ConversationAttribute` (the real classifier) and the preview
 *  harness's possibly-unsaved draft satisfy. */
export interface ClassificationDefinitionInput {
  key: string
  label: string
  description: string | null
  options: readonly ClassificationOptionInput[]
}

/** One validated per-attribute result: `optionId` is either null or a known
 *  option id of that attribute's definition — never a raw, unchecked value. */
export interface ClassificationCallResult {
  key: string
  optionId: string | null
  reasoning: string
}

/** Render the attribute catalogue for the classifier prompt — descriptions
 *  double as the classifier's applies-if/does-not-apply-if guidance. */
export function renderAttributeCatalogue(
  definitions: readonly ClassificationDefinitionInput[]
): string {
  return definitions
    .map((d) => {
      const options = d.options
        .map((o) => `  - ${o.id}: ${o.label}${o.description ? ` (${o.description})` : ''}`)
        .join('\n')
      return [
        `Attribute "${d.key}" (${d.label}):${d.description ? ` ${d.description}` : ''}`,
        'Options:',
        options,
      ].join('\n')
    })
    .join('\n\n')
}

/**
 * Deliberately PERMISSIVE: a shape mismatch (missing/extra fields, wrong
 * types) degrades to `{ results: [] }` via `.catch` rather than throwing, so
 * a malformed-but-parseable model response reproduces the old
 * parse-fail-or-empty → `[]` behavior. A genuine call failure (network,
 * provider error, nothing to parse at all) still rejects the `chat()` call
 * itself and is NOT caught here — see `runClassificationCall`'s doc.
 */
const ClassificationResponseSchema = z
  .object({
    results: z
      .array(
        z.object({
          key: z.string().optional(),
          optionId: z.string().nullable().optional(),
          reasoning: z.string().optional(),
        })
      )
      .catch([]),
  })
  .catch({ results: [] })

export interface RunClassificationCallParams {
  model: string
  definitions: readonly ClassificationDefinitionInput[]
  /** Rendered transcript text — callers own their own truncation/formatting
   *  (a full conversation vs. a single ephemeral sample message differ). */
  transcript: string
  /** Forwarded verbatim to the usage-logging middleware's `metadata` field. */
  usageMetadata: Record<string, unknown>
}

/**
 * The shared core call: renders the catalogue + transcript into one prompt,
 * makes the structured-output chat completion, and validates the response
 * against each definition's own option ids (dropping unknown keys and
 * invalid option ids rather than surfacing them). Never throws on a
 * malformed/empty model response — returns `[]` — but does propagate a
 * hard call failure (network/provider error) so callers can log/handle it
 * their own way (the real classifier's caller catches everything; the
 * preview harness surfaces the error to the admin).
 */
export async function runClassificationCall(
  params: RunClassificationCallParams
): Promise<ClassificationCallResult[]> {
  const { model, definitions, transcript, usageMetadata } = params

  const userContent = [
    'Attributes to classify:',
    renderAttributeCatalogue(definitions),
    '',
    'Conversation transcript:',
    transcript,
  ].join('\n')

  const object = await chat({
    adapter: openaiCompatibleText(model, {
      baseURL: config.openaiBaseUrl!,
      apiKey: config.openaiApiKey!,
    }),
    systemPrompts: [CLASSIFICATION_SYSTEM_PROMPT],
    messages: [{ role: 'user', content: userContent }],
    outputSchema: ClassificationResponseSchema,
    stream: false,
    modelOptions: { max_tokens: 1500, ...structuredOutputProviderOptions() },
    middleware: [
      createUsageLoggingMiddleware({
        pipelineStep: 'classification',
        model,
        metadata: usageMetadata,
      }),
    ],
  })

  const rawResults = object.results
  if (rawResults.length === 0) return []

  const defsByKey = new Map(definitions.map((d) => [d.key, d]))
  const validated: ClassificationCallResult[] = []

  for (const raw of rawResults) {
    if (typeof raw.key !== 'string') continue
    const def = defsByKey.get(raw.key)
    if (!def) continue // unknown key — drop

    let optionId: string | null
    if (raw.optionId === null || raw.optionId === undefined) {
      optionId = null
    } else if (typeof raw.optionId === 'string' && def.options.some((o) => o.id === raw.optionId)) {
      optionId = raw.optionId
    } else {
      continue // invalid optionId — drop
    }

    const reasoning =
      typeof raw.reasoning === 'string' && raw.reasoning.trim()
        ? raw.reasoning.trim()
        : 'No reasoning provided.'

    validated.push({ key: def.key, optionId, reasoning })
  }

  return validated
}
