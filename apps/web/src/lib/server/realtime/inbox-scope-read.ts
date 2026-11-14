/**
 * The owner and team of one inbox item, read by id, for an inbox frame whose
 * publisher did not pass them. Conversations read their own row; tickets read
 * the ticket row, the same columns `ticketFilter` reads, so the stream and the
 * inbox list always agree. Deletion is not read: a deleted ticket's frame
 * still reaches the teammates who held it (row-scope.ts).
 */
import { db, eq, conversations, tickets } from '@/lib/server/db'
import type { ScopedRow } from '@/lib/server/policy/row-scope'
import type { InboxItemRef } from '@/lib/shared/inbox/items'

export async function readInboxItemScope(ref: InboxItemRef): Promise<ScopedRow | null> {
  if (ref.kind === 'conversation') {
    const [row] = await db
      .select({
        assigneePrincipalId: conversations.assignedAgentPrincipalId,
        teamId: conversations.assignedTeamId,
      })
      .from(conversations)
      .where(eq(conversations.id, ref.id))
      .limit(1)
    return row ?? null
  }
  const [row] = await db
    .select({ assigneePrincipalId: tickets.assigneePrincipalId, teamId: tickets.assigneeTeamId })
    .from(tickets)
    .where(eq(tickets.id, ref.id))
    .limit(1)
  return row ?? null
}
