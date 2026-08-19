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
import { buildConversationTranscript, GROUNDING_CHAR_BUDGET } from './transcript'
import { createId, type ConversationId } from '@quackback/ids'
import { logger } from '@/lib/server/logger'

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
- GOOD: "Customer was double-charged for their March invoice after a plan upgrade; refunded $40 and confirmed by the customer."

Example output:
{"summary": "Customer was double-charged for their March invoice after a plan upgrade; refunded $40 and confirmed by the customer."}`

const ConversationSummarySchema = z.object({ summary: z.string() })

/**
 * Prep for the on-close summary: the config-gated no-op guard, the
 * customer-visible transcript load, and the char-budget truncation. Returns
 * `null` when AI isn't configured or there's nothing customer-visible to
 * summarize yet (or the conversation itself can't be found); the caller
 * treats `null` as "nothing to summarize" rather than an error.
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
