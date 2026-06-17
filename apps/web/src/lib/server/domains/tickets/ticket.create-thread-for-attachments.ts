/**
 * Server helper to ensure a ticket has an initial thread for attachments.
 *
 * When a ticket is created, we may want to attach files immediately. Since
 * attachments are stored on threads, we need an initial public thread to link
 * them to. This helper finds the first public thread (usually created by the
 * requester) or creates a synthetic one if none exists.
 *
 * Returns the thread ID suitable for attaching files.
 */
import { db, eq, and, isNull, ticketThreads } from '@/lib/server/db'
import type { TicketId, TicketThreadId, PrincipalId } from '@quackback/ids'
import { addThread } from './ticket.threads'

export async function findOrCreateInitialThread(
  ticketId: TicketId,
  _requesterPrincipalId: PrincipalId | null
): Promise<TicketThreadId> {
  // Look for the first public thread on the ticket (typically created by
  // the requester during creation flow if they added a description).
  const existing = await db.query.ticketThreads.findFirst({
    where: and(
      eq(ticketThreads.ticketId, ticketId),
      eq(ticketThreads.audience, 'public'),
      isNull(ticketThreads.deletedAt)
    ),
  })

  if (existing) {
    return existing.id as TicketThreadId
  }

  // No public thread yet; create a synthetic one to hold attachments.
  // This is an internal system thread (empty body) that won't show in the
  // user-facing thread list — just used for attachment metadata.
  // Use principalId=null to mark it as system-generated.
  const created = await addThread({
    ticketId,
    principalId: null,
    audience: 'public',
    bodyText: '[Attachments added at ticket creation]',
  })

  return created.id as TicketThreadId
}
