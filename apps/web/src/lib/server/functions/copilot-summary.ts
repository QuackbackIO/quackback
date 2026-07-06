/**
 * On-demand conversation summary (Quinn Copilot P2-C.3, manual half): the
 * inbox Copilot panel's Summarize chip. Generates a Question/Summary block
 * for the CURRENT (possibly still-open) conversation, which the panel then
 * writes straight into an internal note, never the customer-facing reply
 * (Fin's pattern, COPILOT-SIDEBAR-UX.md "20 Summarize").
 *
 * Gated on `copilot.use` + the `assistantCopilot` flag + the assistant being
 * configured, mirroring the copilot.ts SSE route's gate order. Reuses
 * `generateConversationSummaryText` (conversation-summary.service.ts), which
 * shares its config-gated guard, transcript load, and truncation with the
 * on-close summary (summarizeConversationOnClose) but never persists
 * anything: no `conversation_summaries` row, no conversation message, no
 * assistant_involvements row. On-close remains the only writer of that
 * table.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { ConversationId } from '@quackback/ids'
import { requireAuth, policyActorFromAuth } from './auth-helpers'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { isFeatureEnabled } from '@/lib/server/domains/settings/settings.service'
import { isAssistantConfigured } from '@/lib/server/domains/assistant'
import { assertConversationViewable } from '@/lib/server/domains/conversation/conversation.service'
import { generateConversationSummaryText } from '@/lib/server/domains/assistant/conversation-summary.service'
import { conversationIdSchema } from '@/lib/server/domains/assistant/conversation-id.schema'
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

      if (!(await isFeatureEnabled('assistantCopilot'))) {
        throw new Error('Copilot is not available')
      }
      if (!isAssistantConfigured()) {
        throw new Error('The assistant is not configured')
      }

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
