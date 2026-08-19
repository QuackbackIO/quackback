/**
 * Deterministic AI attribute classification (AI-ATTRIBUTES-PARITY-SPEC.md
 * Phase 1). Unlike Quinn's `set_attribute` tool (best-effort, only fires when
 * the model elects to call it mid-turn), this is a dedicated classification
 * pass: ONE structured-output chat call classifies every `ai_detect=true`
 * select definition against the conversation transcript, at defined "job
 * done" moments (handoff, assistant close, inactivity close, teammate close)
 * rather than depending on tool-call luck. Phase 2 adds a fifth moment,
 * `live_recheck` — every inbound customer message, while Quinn is
 * participating, when a LIVE workflow condition references an AI attribute
 * (the assistant orchestrator's cost gate) — narrowed via `restrictToKeys` to
 * just the attributes that gate actually references, never the full
 * catalogue.
 *
 * Writes go through the shared `setConversationAttribute` writer with
 * `src: 'ai'`, so the existing precedence rule (AI never overwrites a
 * non-AI value) applies unchanged. A result that would just reproduce the
 * value already on record is skipped before ever calling the writer (churn
 * avoidance — also keeps a re-classification at a later moment from spamming
 * the timeline with a no-op note).
 *
 * Every APPLIED write's reasoning is recorded as ONE combined internal note
 * per classification run (mirrors `appendAssistantHandoffNote` /
 * `appendAssistantPendingActionNote` in conversation.service.ts — an
 * agent-authored, inbox-only `conversation_messages` row — the established
 * durable-timeline mechanism for Quinn's automated actions). Authored under
 * `ensureAssistantPrincipal()` + `quinnActor`'s bounded identity, never a raw
 * service principal.
 *
 * Gated, in order: the `inboxAi` feature flag; a configured AI
 * client + `classification` chat model (the same isAiClientConfigured()/getChatModel()
 * guard the other pipeline classifiers use — sentiment, quality-gate — rather
 * than importing the much larger assistant runtime module just for its
 * equivalent `isAssistantConfigured` check); `enforceAiTokenBudget()`; and at
 * least one enabled definition (narrowed to `detectOnClose` for the
 * `teammate_close` trigger). Every failure path (misconfiguration, a
 * malformed model response, a provider error) is caught and logged here —
 * this never throws into a caller, all of which invoke it fire-and-forget or
 * in a best-effort try/catch of their own.
 */
import { db, conversations, conversationMessages, eq } from '@/lib/server/db'
import type { ConversationId } from '@quackback/ids'
import { config } from '@/lib/server/config'
import { isAiClientConfigured } from '@/lib/server/domains/ai/config'
import { getChatModel } from '@/lib/server/domains/ai/models'
import { enforceAiTokenBudget } from '@/lib/server/domains/settings/tier-enforce'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'
import { isFeatureEnabled } from '@/lib/server/domains/settings/settings.service'
import { loadConversationThread } from '@/lib/server/domains/assistant/assistant.thread'
import { ensureAssistantPrincipal } from '@/lib/server/domains/assistant/assistant.principal'
import { quinnActor } from '@/lib/server/domains/assistant/assistant.actor'
import { publishAgentConversationEvent } from '@/lib/server/realtime/conversation-channels'
import { toMessageDTO } from '@/lib/server/messages/message-core'
import { authorFromInput } from '@/lib/server/domains/conversation/conversation.query'
import { readAttributeValue } from '@/lib/shared/conversation/attribute-values'
import { logger } from '@/lib/server/logger'
import { listConversationAttributes } from './conversation-attribute.service'
import { setConversationAttribute } from './set-attribute.service'
import type { ConversationAttribute } from './conversation-attribute.types'
import {
  runClassificationCall,
  TRANSCRIPT_CHAR_BUDGET,
  type ClassificationDefinitionInput,
} from './classification-core'

const log = logger.child({ component: 'ai-attribute-classification' })

/** The moments classification runs (AI-ATTRIBUTES-PARITY-SPEC.md §3). */
export type ClassificationTrigger =
  | 'handoff'
  | 'assistant_closed'
  | 'inactivity'
  | 'teammate_close'
  | 'live_recheck'

export interface ClassifyAttributesOptions {
  trigger: ClassificationTrigger
  /**
   * Narrow classification to just these keys (Phase 2 live re-check's cost
   * gate — only the attributes a live workflow condition actually
   * references, not every `ai_detect` definition). Applied as an
   * intersection with the per-trigger filter below (e.g. `teammate_close`'s
   * `detectOnClose` narrowing), never in place of it. Omit to classify every
   * enabled definition, as before.
   */
  restrictToKeys?: readonly string[]
}

/** One definition's classified outcome this run — only ever an APPLIED write (see module doc). */
export interface ClassificationOutcome {
  key: string
  applied: boolean
  reasoning: string
}

/** Render the transcript as plain "Customer:"/"Agent:" lines, bounded by TRANSCRIPT_CHAR_BUDGET
 *  (imported from classification-core.ts — shared with the preview harness). */
function buildClassificationTranscript(
  messages: readonly { senderType: string; content: string | null }[]
): string {
  const lines: string[] = []
  for (const m of messages) {
    if (m.senderType === 'system') continue
    const content = m.content?.trim()
    if (!content) continue
    lines.push(`${m.senderType === 'visitor' ? 'Customer' : 'Agent'}: ${content}`)
  }
  const transcript = lines.join('\n')
  return transcript.length > TRANSCRIPT_CHAR_BUDGET
    ? transcript.slice(0, TRANSCRIPT_CHAR_BUDGET) + '\n\n[truncated]'
    : transcript
}

/** Adapt a registry definition to the classification core's structural input shape. */
function toClassificationDefinitionInput(
  definitions: readonly ConversationAttribute[]
): ClassificationDefinitionInput[] {
  return definitions.map((d) => ({
    key: d.key,
    label: d.label,
    description: d.description,
    options: (d.options ?? []).map((o) => ({
      id: o.id,
      label: o.label,
      description: o.description ?? null,
    })),
  }))
}

/** One applied change, for the combined audit note. */
interface AppliedChange {
  label: string
  optionLabel: string
  reasoning: string
}

/**
 * Post ONE internal note recording every applied change this run (mirrors
 * `appendAssistantHandoffNote`'s shape — agent-authored, inbox-only,
 * `conversation_messages`). Best-effort: a failure here must never undo the
 * attribute writes that already landed, so it is caught and logged, not
 * propagated.
 */
async function recordClassificationNote(
  conversationId: ConversationId,
  applied: readonly AppliedChange[]
): Promise<void> {
  try {
    // Bounded Quinn identity (never a raw, role-inheriting service
    // principal) — mirrors the workflow engine's boundedServiceActor
    // pattern. Nothing in this flow is permission-checked (setConversationAttribute
    // takes no actor, and this note insert is the same unchecked shape
    // appendAssistantHandoffNote already uses), but the AUTHOR identity is
    // still Quinn's bounded actor, not an ambient admin-equivalent principal.
    const assistantPrincipal = await ensureAssistantPrincipal()
    const actor = quinnActor(assistantPrincipal.id)
    const author = { principalId: actor.principalId!, displayName: 'Quinn' }

    const lines = applied.map((a) => `- Set ${a.label} → ${a.optionLabel}: ${a.reasoning}`)
    const content = ['Quinn classified this conversation:', ...lines].join('\n')

    const [message] = await db
      .insert(conversationMessages)
      .values({
        conversationId,
        principalId: author.principalId,
        senderType: 'agent',
        isInternal: true,
        content,
      })
      .returning()
    const messageDTO = toMessageDTO(message, authorFromInput(author), author.principalId)
    publishAgentConversationEvent({ kind: 'message', conversationId, message: messageDTO })
  } catch (err) {
    log.warn({ err, conversationId }, 'failed to record ai attribute classification note')
  }
}

/**
 * Classify a conversation's enabled attributes and write through the shared
 * writer. Returns the outcomes for writes that actually landed (an invalid,
 * churn-skipped, or precedence-blocked result never appears in the returned
 * array — see the module doc). Never throws.
 */
export async function classifyConversationAttributes(
  conversationId: ConversationId,
  opts: ClassifyAttributesOptions
): Promise<ClassificationOutcome[]> {
  try {
    if (!(await isFeatureEnabled('inboxAi'))) return []

    const model = getChatModel('classification')
    if (!isAiClientConfigured(config.openaiApiKey, config.openaiBaseUrl) || !model) return []

    try {
      await enforceAiTokenBudget()
    } catch (err) {
      if (err instanceof TierLimitError) {
        log.info(
          { conversationId, trigger: opts.trigger },
          'attribute classification skipped: ai token budget exceeded'
        )
        return []
      }
      throw err
    }

    const enabled = await listConversationAttributes({ aiDetectOnly: true })
    let definitions =
      opts.trigger === 'teammate_close' ? enabled.filter((d) => d.detectOnClose) : enabled
    if (opts.restrictToKeys) {
      const allow = new Set(opts.restrictToKeys)
      definitions = definitions.filter((d) => allow.has(d.key))
    }
    if (definitions.length === 0) return []

    const messages = await loadConversationThread(conversationId)
    const transcript = buildClassificationTranscript(messages)
    if (!transcript) return []

    const [row] = await db
      .select({ customAttributes: conversations.customAttributes })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1)
    const currentAttributes = (row?.customAttributes ?? {}) as Record<string, unknown>

    const results = await runClassificationCall({
      model,
      definitions: toClassificationDefinitionInput(definitions),
      transcript,
      usageMetadata: { conversationId, trigger: opts.trigger },
    })
    if (results.length === 0) return []

    const defsByKey = new Map(definitions.map((d) => [d.key, d]))
    const outcomes: ClassificationOutcome[] = []
    const appliedChanges: AppliedChange[] = []

    for (const raw of results) {
      const def = defsByKey.get(raw.key)
      if (!def) continue // unknown key — drop (defense in depth; the core already validates against the same catalogue)
      const optionId = raw.optionId
      const reasoning = raw.reasoning

      // Churn avoidance: a result that would just reproduce the value
      // already on record (whatever its source) never reaches the writer.
      const current = readAttributeValue(currentAttributes[def.key])
      if ((current?.v ?? null) === optionId) continue

      const updated = await setConversationAttribute({ conversationId }, def.key, optionId, 'ai')
      const applied =
        optionId === null
          ? updated[def.key] === undefined
          : readAttributeValue(updated[def.key])?.v === optionId
      if (!applied) continue // precedence rule blocked it (a human/workflow already owns the slot)

      outcomes.push({ key: def.key, applied: true, reasoning })
      const optionLabel =
        optionId === null
          ? '(cleared)'
          : ((def.options ?? []).find((o) => o.id === optionId)?.label ?? optionId)
      appliedChanges.push({ label: def.label, optionLabel, reasoning })
    }

    if (appliedChanges.length > 0) {
      await recordClassificationNote(conversationId, appliedChanges)
    }

    return outcomes
  } catch (err) {
    log.error({ err, conversationId, trigger: opts.trigger }, 'attribute classification failed')
    return []
  }
}
