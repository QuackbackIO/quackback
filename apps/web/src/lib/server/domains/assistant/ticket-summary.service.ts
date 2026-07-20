/**
 * Ticket resolution-summary service (Quinn Phase 4: ticket grounding).
 *
 * The ticket sibling of `summarizeConversationOnClose`
 * (conversation-summary.service.ts): generates a short AI summary of a
 * ticket's customer-visible thread when it closes, so Quinn's copilot can
 * later ground on how similar tickets were resolved (see
 * `tickets-retrieval.ts`). Same shape as the conversation on-close path —
 * config-gated no-op, a schema-validated `chat({ stream: false })` structured
 * call, embed via the shared `generateEmbedding`, upsert one row per ticket
 * keyed on `ticketId`.
 *
 * TWO differences from the conversation summary:
 *   - The source text is the ticket thread via `listTicketMessages({
 *     includeInternal: false })`, which excludes internal notes in SQL — a
 *     note can never leak into a summary the copilot might later surface.
 *     CONVERGENCE PHASE 0: that read is now the pair union (pair-thread.service)
 *     — the linked conversation's customer-visible messages fold in; internal
 *     notes are stripped on BOTH parents, so the exclusion guarantee is
 *     unchanged.
 *   - The row is NOT customer-scoped. A closed ticket is team knowledge
 *     retrieved across every requester (tickets-retrieval.ts is a copilot-only,
 *     team-ceiling source), so `requesterPrincipalId` is denormalized for
 *     provenance only, never a retrieval predicate.
 *
 * `summarizeTicketOnClose` is best-effort end to end: every failure
 * (unconfigured AI, a malformed model response, a DB error) is caught and
 * logged here, so it never throws into its caller — the event hook
 * (events/process.ts) fires it fire-and-forget off `ticket.status_changed →
 * closed`, exactly as the conversation-close branch fires its sibling.
 */
import { chat } from '@tanstack/ai'
import { openaiCompatibleText } from '@tanstack/ai-openai/compatible'
import { z } from 'zod'
import { db, tickets, ticketSummaries, eq, sql } from '@/lib/server/db'
import { config } from '@/lib/server/config'
import {
  isAiClientConfigured,
  structuredOutputProviderOptions,
} from '@/lib/server/domains/ai/config'
import { createUsageLoggingMiddleware } from '@/lib/server/domains/ai/usage-middleware'
import { getChatModel, getEmbeddingModel } from '@/lib/server/domains/ai/models'
import { enforceAiTokenBudget } from '@/lib/server/domains/settings/tier-enforce'
import { generateEmbedding } from '@/lib/server/domains/embeddings/embedding.service'
import { listTicketMessages } from '@/lib/server/domains/tickets/ticket-message.service'
import { buildTicketTranscript, GROUNDING_CHAR_BUDGET } from './transcript'
import { createId, type TicketId } from '@quackback/ids'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'ticket-summary' })

const SYSTEM_PROMPT = `You are a support analyst writing a brief on a just-closed support ticket, for a future AI copilot helping a teammate resolve a similar ticket.

Return strict JSON only:
{
  "summary": "string"
}

Rules for "summary" (2-4 sentences):
- Lead with the problem the customer had, not "The customer asked about X."
- Name specifics: what feature, what workflow, what broke, what error.
- Note how it was resolved: the fix, the workaround, or that it was closed without one.
- Write for a future AI copilot that needs just enough context to reuse the resolution, not a full transcript replay.
- BAD: "The customer had a login issue."
- GOOD: "SSO login failed with a 'redirect_uri mismatch' after the customer changed their Okta domain; resolved by re-adding the new callback URL in the SSO settings."`

const TicketSummarySchema = z.object({ summary: z.string() })

/**
 * Summarize a just-closed ticket and upsert the result (one row per ticket,
 * keyed on `ticketId`). No-ops when the AI client or the `summary` chat model
 * isn't configured — mirrors `summarizeConversationOnClose`'s guard — and
 * never throws: every failure path (missing ticket, empty transcript,
 * malformed model output, a DB or provider error) is logged and swallowed,
 * since this runs fire-and-forget off the ticket-close event.
 */
export async function summarizeTicketOnClose(ticketId: TicketId): Promise<void> {
  try {
    await enforceAiTokenBudget()

    const model = getChatModel('summary')
    if (!isAiClientConfigured(config.openaiApiKey, config.openaiBaseUrl) || !model) return

    const [ticketRow, thread] = await Promise.all([
      db.query.tickets.findFirst({
        where: eq(tickets.id, ticketId),
        columns: { requesterPrincipalId: true },
      }),
      listTicketMessages(ticketId, { includeInternal: false }),
    ])
    if (!ticketRow) {
      log.warn({ ticket_id: ticketId }, 'ticket not found for summary')
      return
    }

    const transcript = buildTicketTranscript(thread.messages)
    if (!transcript) return // nothing customer-visible happened; no summary to write

    const truncated =
      transcript.length > GROUNDING_CHAR_BUDGET
        ? transcript.slice(0, GROUNDING_CHAR_BUDGET) + '\n\n[truncated]'
        : transcript

    // Usage-logged under 'ticket_summary' — a fire-and-forget close-time meter
    // against aiTokensPerMonth, distinct from the on-demand copilot Summarize
    // chip's 'copilot_summary' (analytics/copilot-usage.ts counts only the
    // latter), matching how the conversation on-close path stays off that report.
    const object = await chat({
      adapter: openaiCompatibleText(model, {
        baseURL: config.openaiBaseUrl!,
        apiKey: config.openaiApiKey!,
      }),
      systemPrompts: [SYSTEM_PROMPT],
      messages: [{ role: 'user', content: truncated }],
      outputSchema: TicketSummarySchema,
      stream: false,
      modelOptions: { max_tokens: 400, ...structuredOutputProviderOptions() },
      middleware: [
        createUsageLoggingMiddleware({
          pipelineStep: 'ticket_summary',
          model,
          metadata: { ticketId },
        }),
      ],
    })

    const summaryText = object.summary.trim()
    if (!summaryText) {
      log.error({ ticket_id: ticketId }, 'invalid ticket summary shape')
      return
    }

    // Best-effort: a failed/unavailable embedding still saves the summary text
    // (retrieval's keyword fallback can still use it), just without the
    // semantic ranking path.
    const embedding = await generateEmbedding(summaryText, {
      pipelineStep: 'ticket_summary_embedding',
    })

    const values = {
      ticketId,
      requesterPrincipalId: ticketRow.requesterPrincipalId,
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
      .insert(ticketSummaries)
      .values({ id: createId('ticket_summary'), ...values })
      .onConflictDoUpdate({
        target: ticketSummaries.ticketId,
        set: values,
      })

    log.info({ ticket_id: ticketId }, 'ticket summary generated')
  } catch (err) {
    log.error({ err, ticket_id: ticketId }, 'ticket summary generation failed')
  }
}
