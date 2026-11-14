/**
 * The owner and team of one inbox item, read by id, for an inbox frame whose
 * publisher did not pass them. Conversations read their own row; tickets read
 * the ticket row, the same columns `ticketFilter` reads, so the stream and the
 * inbox list always agree. Deletion is not read: a deleted ticket's frame
 * still reaches the teammates who held it (row-scope.ts).
 */
import { db, eq, conversations, tickets } from '@/lib/server/db'
import type { ConversationId, TicketId } from '@quackback/ids'
import type { InboxItemScope } from './inbox-envelope'

export async function readInboxItemScope(
  kind: 'conversation' | 'ticket',
  id: string
): Promise<InboxItemScope | null> {
  if (kind === 'conversation') {
    const [row] = await db
      .select({
        assigneePrincipalId: conversations.assignedAgentPrincipalId,
        teamId: conversations.assignedTeamId,
      })
      .from(conversations)
      .where(eq(conversations.id, id as ConversationId))
      .limit(1)
    return row ?? null
  }
  const [row] = await db
    .select({ assigneePrincipalId: tickets.assigneePrincipalId, teamId: tickets.assigneeTeamId })
    .from(tickets)
    .where(eq(tickets.id, id as TicketId))
    .limit(1)
  return row ?? null
}
