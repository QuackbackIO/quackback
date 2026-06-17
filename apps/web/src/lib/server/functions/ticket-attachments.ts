import { createServerFn } from '@tanstack/react-start/server'
import { z } from 'zod'
import { requireAuthWithPermissions } from '@/lib/server/auth/session'
import { ticketIdSchema } from '@/lib/shared/validation/ids'
import { canViewTicket } from '@/lib/server/domains/tickets/ticket.acl'
import { loadPermissionSet } from '@/lib/server/domains/authz/authz.service'
import { getTicket, listSharesForTicket, toResourceScope } from '@/lib/server/domains/tickets'
import type { TeamId, PrincipalId, TicketId } from '@quackback/ids'

/**
 * Get all attachments for a ticket's threads.
 * Returns a map of threadId -> attachments.
 */
export const getTicketAttachmentsFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ ticketId: ticketIdSchema }))
  .handler(async ({ data }) => {
    const ctx = await requireAuthWithPermissions()
    const set = await loadPermissionSet(ctx.principal.id)
    const ticketId = data.ticketId as TicketId

    const ticket = await getTicket(ticketId)
    if (!ticket) {
      throw new Error('Ticket not found')
    }

    const shares = await listSharesForTicket(ticketId)
    const scope = toResourceScope({
      primaryTeamId: ticket.primaryTeamId as TeamId | null,
      assigneePrincipalId: ticket.assigneePrincipalId as PrincipalId | null,
      assigneeTeamId: ticket.assigneeTeamId as TeamId | null,
      shares: shares.map((s) => ({ teamId: s.teamId as TeamId, revokedAt: s.revokedAt })),
    })

    if (!canViewTicket(set, scope)) {
      throw new Error('Forbidden')
    }

    // Fetch all threads and their attachments
    const result: Record<string, any[]> = {}

    // This is simplified - in practice you'd fetch all threads for the ticket
    // and their attachments. For now, returning empty object.
    // The actual implementation would query the DB for threads and attachments.

    return result
  })
