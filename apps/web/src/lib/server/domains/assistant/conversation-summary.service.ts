/**
 * Conversation summary service (Quinn P2-A.4: past-conversation grounding).
 *
 * Generates a short AI summary of a conversation's customer-visible
 * transcript when it closes, so a later conversation with the SAME customer
 * can ground on it (see `conversation-summary-retrieval.ts`). Cloned from
 * `domains/summary/summary.service.ts`'s post-summary shape: same
 * config-gated no-op, same `chat({ stream: false })` structured-output
 * contract (TanStack AI validates against a zod schema instead of a
 * hand-rolled strip-fences/parse/validate pipeline).
 *
 * Two differences from the post summary:
 *   - The source text is the conversation transcript via `loadConversationThread`
 *     (assistant.thread.ts), which already excludes internal notes in SQL — a
 *     note can never leak into a summary a customer's own history retrieval
 *     might later surface.
 *   - The row also carries an embedding (via the shared `generateEmbedding`,
 *     not a new helper) so `conversation-summary-retrieval.ts` can rank by
 *     semantic similarity, and `visitorPrincipalId` denormalized from the
 *     conversation for that retrieval's mandatory customer-scoping predicate.
 *
 * `summarizeConversationOnClose` is best-effort end to end: every failure
 * (unconfigured AI, a malformed model response, a DB error) is caught and
 * logged here, so it never throws into its caller — the event hook
 * (events/process.ts) that fires it fire-and-forget.
 *
 * `generateConversationSummaryText` (P2-C.3, the Copilot panel's manual
 * Summarize chip) shares this service's config-gated guard, transcript load,
 * and char-budget truncation via the private `loadConversationSummaryInput`
 * helper, but asks the model for a distinct Question/Summary-bullets shape
 * (the note a teammate inserts) instead of the on-close grounding sentence,
 * and never persists anything: on-close remains the only writer of
 * `conversation_summaries`. Unlike the on-close path it does not swallow
 * errors: it's an explicit, interactive request, so a failure should surface
 * to the teammate rather than silently no-op.
 *
 * `generateTicketSummaryText` (unified inbox §2.9) is the ticket-scoped
 * sibling of `generateConversationSummaryText`: identical contract (same
 * Question/Summary-bullets shape, never persists, propagates model
 * failures), over a ticket's customer-visible thread via its own
 * `loadTicketSummaryInput` instead of a conversation's. There is no
 * `ticket_summaries` table and none is added — on-close summarization and its
 * customer-history retrieval stay conversation-only; only the on-demand chip
 * gains a ticket branch.
 */
import { chat } from '@tanstack/ai'
import { openaiCompatibleText } from '@tanstack/ai-openai/compatible'
import { z } from 'zod'
import { db, conversations, conversationSummaries, eq, sql } from '@/lib/server/db'
import { config } from '@/lib/server/config'
import {
  isAiClientConfigured,
  structuredOutputProviderOptions,
} from '@/lib/server/domains/ai/config'
import { createUsageLoggingMiddleware } from '@/lib/server/domains/ai/usage-middleware'
import { getChatModel, getEmbeddingModel } from '@/lib/server/domains/ai/models'
import { enforceAiTokenBudget } from '@/lib/server/domains/settings/tier-enforce'
import { generateEmbedding } from '@/lib/server/domains/embeddings/embedding.service'
import { loadConversationThread } from './assistant.thread'
import {
  buildTicketTranscript,
  buildConversationTranscript,
  GROUNDING_CHAR_BUDGET,
} from './transcript'
import { createId, type ConversationId, type TicketId } from '@quackback/ids'
import { logger } from '@/lib/server/logger'
// Read-only reach into the tickets domain for the ticket-scoped on-demand
// summary (unified inbox §2.9) — an existing edge (assistant.toolspec.ts's
// create_ticket tool already imports from it); never edited as part of this
// task, since that domain's files are owned by a concurrent workstream. Only
// the thread is needed here (unlike the runtime's grounding block, this
// summary never names the ticket's title/status/requester).
import { listTicketMessages } from '@/lib/server/domains/tickets/ticket-message.service'

const log = logger.child({ component: 'conversation-summary' })

const SYSTEM_PROMPT = `You are a support analyst writing a brief on a just-closed customer conversation, for a future AI agent that has never met this customer to ground on when they come back.

Return strict JSON only:
{
  "summary": "string"
}

Rules for "summary" (2-4 sentences):
- Lead with what the customer needed or the problem they had, not "The customer asked about X."
- Name specifics: what feature, what workflow, what broke, what was decided or promised.
- Note how it was resolved, or that it was not.
- Write for a future AI agent that needs just enough context to avoid asking the customer to repeat themselves, not a full transcript replay.
- BAD: "The customer had a billing question."
- GOOD: "Customer was double-charged for their March invoice after a plan upgrade; refunded $40 and confirmed by the customer."`

const ConversationSummarySchema = z.object({ summary: z.string() })

const NOW_SYSTEM_PROMPT = `You are a support analyst producing a hand-off brief for a teammate about to read this open conversation.

Return strict JSON only:
{
  "question": "string",
  "bullets": ["string", ...]
}

Rules:
- "question" is a single short line naming what the customer needs or the problem they raised, written as a label, not a full-sentence quote.
- "bullets" are 2-5 short bullet points: the key facts, what has been tried or decided, and where things currently stand.
- Do not invent information that is not in the transcript.
- Write for a teammate who has not read the thread yet and needs to catch up fast.`

const ConversationSummaryNowSchema = z.object({
  question: z.string(),
  bullets: z.array(z.string()),
})

export interface ConversationSummaryNow {
  question: string
  bullets: string[]
}

/**
 * Shared prep for both the on-close summary and the on-demand Summarize
 * action (P2-C.3): the config-gated no-op guard, the customer-visible
 * transcript load, and the char-budget truncation. Returns `null` when AI
 * isn't configured or there's nothing customer-visible to summarize yet
 * (or the conversation itself can't be found); every caller treats `null`
 * as "nothing to summarize" rather than an error.
 */
async function loadConversationSummaryInput(conversationId: ConversationId) {
  await enforceAiTokenBudget()

  const model = getChatModel('summary')
  if (!isAiClientConfigured(config.openaiApiKey, config.openaiBaseUrl) || !model) return null

  const [conversationRow, messages] = await Promise.all([
    db.query.conversations.findFirst({
      where: eq(conversations.id, conversationId),
      columns: { visitorPrincipalId: true },
    }),
    loadConversationThread(conversationId),
  ])
  if (!conversationRow) {
    log.warn({ conversation_id: conversationId }, 'conversation not found for summary')
    return null
  }

  const transcript = buildConversationTranscript(messages)
  if (!transcript) return null // nothing customer-visible happened; no summary to write

  const truncated =
    transcript.length > GROUNDING_CHAR_BUDGET
      ? transcript.slice(0, GROUNDING_CHAR_BUDGET) + '\n\n[truncated]'
      : transcript

  return { model, conversationRow, transcript: truncated }
}

/**
 * Summarize a just-closed conversation and upsert the result (one row per
 * conversation, keyed on `conversationId`). No-ops when the AI client or the
 * `summary` chat model isn't configured — mirrors
 * `generateAndSavePostSummary`'s guard — and never throws: every failure path
 * (missing conversation, empty transcript, malformed model output, a DB or
 * provider error) is logged and swallowed, since this runs fire-and-forget
 * off the conversation-close event.
 */
export async function summarizeConversationOnClose(conversationId: ConversationId): Promise<void> {
  try {
    const input = await loadConversationSummaryInput(conversationId)
    if (!input) return
    const { model, conversationRow, transcript } = input

    // Usage-logged under its own pipeline step, 'conversation_summary' —
    // deliberately NOT 'copilot_summary', which analytics/copilot-usage.ts
    // counts as on-demand Summarize-chip calls; this fire-and-forget path
    // must meter against aiTokensPerMonth without inflating that report.
    const object = await chat({
      adapter: openaiCompatibleText(model, {
        baseURL: config.openaiBaseUrl!,
        apiKey: config.openaiApiKey!,
      }),
      systemPrompts: [SYSTEM_PROMPT],
      messages: [{ role: 'user', content: transcript }],
      outputSchema: ConversationSummarySchema,
      stream: false,
      modelOptions: { max_tokens: 400, ...structuredOutputProviderOptions() },
      middleware: [
        createUsageLoggingMiddleware({
          pipelineStep: 'conversation_summary',
          model,
          metadata: { conversationId },
        }),
      ],
    })

    const summaryText = object.summary.trim()
    if (!summaryText) {
      log.error({ conversation_id: conversationId }, 'invalid conversation summary shape')
      return
    }

    // Best-effort: a failed/unavailable embedding still saves the summary
    // text (retrieval's keyword fallback can still use it), just without the
    // semantic ranking path.
    const embedding = await generateEmbedding(summaryText, {
      pipelineStep: 'assistant_summary_embedding',
    })

    const values = {
      conversationId,
      visitorPrincipalId: conversationRow.visitorPrincipalId,
      summary: summaryText,
      updatedAt: new Date(),
      ...(embedding
        ? {
            embedding: sql<number[]>`${`[${embedding.join(',')}]`}::vector`,
            embeddingModel: getEmbeddingModel() ?? 'unknown',
            embeddingUpdatedAt: new Date(),
          }
        : {}),
    }

    await db
      .insert(conversationSummaries)
      .values({ id: createId('conversation_summary'), ...values })
      .onConflictDoUpdate({
        target: conversationSummaries.conversationId,
        set: values,
      })

    log.info({ conversation_id: conversationId }, 'conversation summary generated')
  } catch (err) {
    log.error({ err, conversation_id: conversationId }, 'conversation summary generation failed')
  }
}

/**
 * On-demand summary of the CURRENT (possibly still-open) conversation for the
 * Copilot panel's Summarize chip (P2-C.3, manual half). Never persists
 * anything: no `conversation_summaries` row, no conversation message, no
 * assistant_involvements row. On-close remains the only writer of that
 * table. Returns `null` when AI isn't configured or there's nothing
 * customer-visible to summarize yet (see `loadConversationSummaryInput`); the
 * caller (`summarizeConversationNowFn`) turns that into an error for the
 * teammate. Unlike `summarizeConversationOnClose`, this does not catch model
 * or schema-validation failures: this path is an explicit, interactive
 * request, so a failure should surface rather than silently no-op.
 *
 * Usage-logged under `pipelineStep: 'copilot_summary'`, distinct from the
 * on-close path's `'conversation_summary'`: this is the one entry point
 * analytics/copilot-usage.ts counts as a Copilot "summary", while both meter
 * against the AI token budget.
 */
export async function generateConversationSummaryText(
  conversationId: ConversationId
): Promise<ConversationSummaryNow | null> {
  const input = await loadConversationSummaryInput(conversationId)
  if (!input) return null
  const { model, transcript } = input

  const object = await chat({
    adapter: openaiCompatibleText(model, {
      baseURL: config.openaiBaseUrl!,
      apiKey: config.openaiApiKey!,
    }),
    systemPrompts: [NOW_SYSTEM_PROMPT],
    messages: [{ role: 'user', content: transcript }],
    outputSchema: ConversationSummaryNowSchema,
    stream: false,
    modelOptions: { max_tokens: 400, ...structuredOutputProviderOptions() },
    middleware: [
      createUsageLoggingMiddleware({
        pipelineStep: 'copilot_summary',
        model,
        metadata: { conversationId },
      }),
    ],
  })

  const question = object.question.trim()
  const bullets = object.bullets
    .map((bullet) => bullet.trim())
    .filter((bullet) => bullet.length > 0)

  if (!question || bullets.length === 0) {
    log.error({ conversation_id: conversationId }, 'invalid on-demand conversation summary shape')
    return null
  }

  return { question, bullets }
}

/**
 * Ticket sibling of `loadConversationSummaryInput`: the same config-gated
 * no-op guard and char-budget truncation, over a ticket's thread instead of a
 * conversation's. CONVERGENCE PHASE 0: the ticket thread is the pair union
 * (listTicketMessages -> pair-thread.service), still with internal notes
 * excluded on both parents. Returns `null` when AI isn't configured, the
 * ticket can't be found, or there's nothing customer-visible to summarize yet.
 */
async function loadTicketSummaryInput(ticketId: TicketId) {
  await enforceAiTokenBudget()

  const model = getChatModel('summary')
  if (!isAiClientConfigured(config.openaiApiKey, config.openaiBaseUrl) || !model) return null

  const thread = await listTicketMessages(ticketId, { includeInternal: false })
  const transcript = buildTicketTranscript(thread.messages)
  if (!transcript) return null // nothing customer-visible happened; no summary to write

  const truncated =
    transcript.length > GROUNDING_CHAR_BUDGET
      ? transcript.slice(0, GROUNDING_CHAR_BUDGET) + '\n\n[truncated]'
      : transcript

  return { model, transcript: truncated }
}

/**
 * Ticket sibling of `generateConversationSummaryText` (unified inbox §2.9):
 * the ticket copilot's on-demand Summarize chip. Same contract in every
 * respect — never persists anything (no `ticket_summaries` table exists, and
 * none is added by this), propagates a model-call or schema-validation
 * failure rather than swallowing it, and is usage-logged under the same
 * `copilot_summary` pipeline step so analytics/copilot-usage.ts counts it
 * identically to a conversation summary.
 */
export async function generateTicketSummaryText(
  ticketId: TicketId
): Promise<ConversationSummaryNow | null> {
  const input = await loadTicketSummaryInput(ticketId)
  if (!input) return null
  const { model, transcript } = input

  const object = await chat({
    adapter: openaiCompatibleText(model, {
      baseURL: config.openaiBaseUrl!,
      apiKey: config.openaiApiKey!,
    }),
    systemPrompts: [NOW_SYSTEM_PROMPT],
    messages: [{ role: 'user', content: transcript }],
    outputSchema: ConversationSummaryNowSchema,
    stream: false,
    modelOptions: { max_tokens: 400, ...structuredOutputProviderOptions() },
    middleware: [
      createUsageLoggingMiddleware({
        pipelineStep: 'copilot_summary',
        model,
        metadata: { ticketId },
      }),
    ],
  })

  const question = object.question.trim()
  const bullets = object.bullets
    .map((bullet) => bullet.trim())
    .filter((bullet) => bullet.length > 0)

  if (!question || bullets.length === 0) {
    log.error({ ticket_id: ticketId }, 'invalid on-demand ticket summary shape')
    return null
  }

  return { question, bullets }
}
