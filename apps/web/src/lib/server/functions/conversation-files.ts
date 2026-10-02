/**
 * The inbox detail panel's Files section: every attachment across a
 * conversation or ticket's whole thread, newest first (lib/server/domains/
 * files/files.query.ts). Agent-only, read-only.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { isValidTypeId } from '@quackback/ids'
import type { ConversationId, TicketId } from '@quackback/ids'
import { requireAuth, policyActorFromAuth } from './auth-helpers'
import { isTeamMember } from '@/lib/shared/roles'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { ForbiddenError, ValidationError } from '@/lib/shared/errors'

const inputSchema = z
  .object({
    conversationId: z.string().min(1).optional(),
    ticketId: z.string().min(1).optional(),
  })
  .refine((d) => Boolean(d.conversationId) !== Boolean(d.ticketId), {
    message: 'Provide exactly one of conversationId or ticketId',
  })

/**
 * Gated like `exportConversationTranscriptFn` (lib/server/functions/
 * conversation.ts): CONVERSATION_VIEW plus an explicit team-member check
 * (belt-and-suspenders against a custom role granted the permission), then
 * `assertConversationViewable` for the item-scoped check. A ticket target
 * gates on TICKET_VIEW + `assertTicketVisible` instead, mirroring
 * `getTicketActivityFn` (lib/server/functions/tickets.ts) — that fn's own
 * existence+visibility fusion already excludes non-team callers, so no
 * separate team-member check is needed on that branch.
 */
export const listConversationFilesFn = createServerFn({ method: 'GET' })
  .validator((d: unknown) => inputSchema.parse(d))
  .handler(async ({ data }) => {
    const { listConversationFiles } = await import('@/lib/server/domains/files/files.query')

    if (data.conversationId) {
      if (!isValidTypeId(data.conversationId, 'conversation')) {
        throw new ValidationError('VALIDATION_ERROR', 'Invalid conversation id')
      }
      const ctx = await requireAuth({ permission: PERMISSIONS.CONVERSATION_VIEW })
      if (!isTeamMember(ctx.principal.role)) {
        throw new ForbiddenError('FORBIDDEN', 'Only team members can view conversation files')
      }
      const actor = await policyActorFromAuth(ctx)
      const { assertConversationViewable } =
        await import('@/lib/server/domains/conversation/conversation.service')
      await assertConversationViewable(data.conversationId as ConversationId, actor)
      return listConversationFiles({ conversationId: data.conversationId as ConversationId })
    }

    if (!data.ticketId || !isValidTypeId(data.ticketId, 'ticket')) {
      throw new ValidationError('VALIDATION_ERROR', 'Invalid ticket id')
    }
    const ctx = await requireAuth({ permission: PERMISSIONS.TICKET_VIEW })
    const actor = await policyActorFromAuth(ctx)
    const { assertTicketVisible } = await import('@/lib/server/domains/tickets/ticket.service')
    await assertTicketVisible(data.ticketId as TicketId, actor)
    return listConversationFiles({ ticketId: data.ticketId as TicketId })
  })
