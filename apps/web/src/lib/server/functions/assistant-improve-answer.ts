/**
 * Improve-answer server fn: a teammate marks a Quinn answer unhelpful and
 * attaches the ideal answer. One call appends the outcome event and persists
 * the correction as a retrievable snippet (domains/assistant/answer-correction.ts).
 * Gated on conversation.reply — the teammates who answer conversations are the
 * ones who review and correct Quinn's answers.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import type { ConversationId, TicketId } from '@quackback/ids'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { logger } from '@/lib/server/logger'
import { requireAuth } from './auth-helpers'

const log = logger.child({ component: 'assistant-improve-answer' })

const improveAnswerSchema = z.object({
  question: z.string().min(1).max(2000),
  idealAnswer: z.string().min(1).max(2000),
  reason: z.string().max(500).optional(),
  conversationId: z.string().optional(),
  ticketId: z.string().optional(),
  messageId: z.string().optional(),
  audience: z.enum(['public', 'team', 'internal']).optional(),
})

export const improveAssistantAnswerFn = createServerFn({ method: 'POST' })
  .validator(improveAnswerSchema)
  .handler(async ({ data }) => {
    log.info('improve assistant answer')
    const ctx = await requireAuth({ permission: PERMISSIONS.CONVERSATION_REPLY })
    const { recordAnswerCorrection } =
      await import('@/lib/server/domains/assistant/answer-correction')
    return recordAnswerCorrection({
      question: data.question,
      idealAnswer: data.idealAnswer,
      reason: data.reason,
      conversationId: data.conversationId as ConversationId | undefined,
      ticketId: data.ticketId as TicketId | undefined,
      messageId: data.messageId,
      audience: data.audience,
      principalId: ctx.principal.id,
    })
  })
