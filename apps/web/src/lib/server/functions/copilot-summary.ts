/**
 * On-demand item summary (Quinn Copilot P2-C.3, manual half; ticket sibling
 * added by unified inbox §2.9): the inbox Copilot panel's Summarize chip.
 * Generates a Question/Summary block for the CURRENT (possibly still-open)
 * conversation or ticket, which the panel then writes straight into an
 * internal note, never the customer-facing reply (Fin's pattern,
 * COPILOT-SIDEBAR-UX.md "20 Summarize").
 *
 * Both fns are gated on `copilot.use` + `assertCopilotAvailable` (the
 * `assistantCopilot` flag + the assistant being configured), mirroring the
 * copilot.ts SSE route's gate order, then the item-scoped viewability check
 * (`assertConversationViewable` / `assertTicketVisible`). Each reuses its
 * matching generator in conversation-summary.service.ts
 * (`generateConversationSummaryText` / `generateTicketSummaryText`), which
 * shares its config-gated guard, transcript load, and truncation with the
 * on-close summary (summarizeConversationOnClose) but never persists
 * anything: no `conversation_summaries` (or `ticket_summaries` — no such
 * table exists) row, no message, no assistant_involvements row. On-close
 * remains the only writer of `conversation_summaries`.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { ConversationId, TicketId } from '@quackback/ids'
import { requireAuth, policyActorFromAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { assertCopilotAvailable } from '@/lib/server/domains/assistant/copilot-gate'
import { assertConversationViewable } from '@/lib/server/domains/conversation/conversation.service'
import { assertTicketVisible } from '@/lib/server/domains/tickets/ticket.service'
import {
  generateConversationSummaryText,
  generateTicketSummaryText,
} from '@/lib/server/domains/assistant/conversation-summary.service'
import { conversationIdSchema } from '@/lib/server/domains/assistant/conversation-id.schema'
import { ticketIdSchema } from '@/lib/server/domains/assistant/item-ref.schema'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'copilot-summary-fn' })

const summarizeConversationNowSchema = z.object({
  conversationId: conversationIdSchema,
})

export const summarizeConversationNowFn = createServerFn({ method: 'POST' })
  .validator(summarizeConversationNowSchema)
  .handler(async ({ data }) => {
    try {
      const auth = await requireAuth({ permission: PERMISSIONS.COPILOT_USE })
      await assertCopilotAvailable()

      const conversationId = data.conversationId as ConversationId
      const actor = await policyActorFromAuth(auth)
      await assertConversationViewable(conversationId, actor)

      const result = await generateConversationSummaryText(conversationId)
      if (!result) {
        throw new Error('Not enough conversation yet to summarize')
      }
      return result
    } catch (error) {
      log.error({ err: error }, 'on-demand conversation summary failed')
      throw error
    }
  })

const summarizeTicketNowSchema = z.object({
  ticketId: ticketIdSchema,
})

/** Ticket sibling of `summarizeConversationNowFn` (unified inbox §2.9). */
export const summarizeTicketNowFn = createServerFn({ method: 'POST' })
  .validator(summarizeTicketNowSchema)
  .handler(async ({ data }) => {
    try {
      const auth = await requireAuth({ permission: PERMISSIONS.COPILOT_USE })
      await assertCopilotAvailable()

      const ticketId = data.ticketId as TicketId
      const actor = await policyActorFromAuth(auth)
      await assertTicketVisible(ticketId, actor)

      const result = await generateTicketSummaryText(ticketId)
      if (!result) {
        throw new Error('Not enough ticket thread yet to summarize')
      }
      return result
    } catch (error) {
      log.error({ err: error }, 'on-demand ticket summary failed')
      throw error
    }
  })
