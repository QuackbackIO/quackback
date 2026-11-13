/**
 * A ticket's first response (`tickets.first_response_at`): when a teammate
 * first replied to the customer.
 *
 * It is worked out from the message rows, never stamped by an action, so it
 * does not depend on the order writes or queued jobs run in:
 *
 * - The thread is the ticket's own messages, plus, on a customer ticket paired
 *   with a conversation, that conversation's messages. A provenance link (a
 *   back-office ticket or a tracker opened from a conversation) adds nothing.
 * - Only public, undeleted messages count.
 * - The clock starts at the customer's first message (`sender_type =
 *   'visitor'`). A ticket the customer has not written on has no first
 *   response, so a teammate's opening message, or anything a teammate writes
 *   before the customer does, never counts. Back-office and tracker tickets
 *   have no customer, so their value stays empty.
 * - The first response is the earliest human reply (the shared reply rule,
 *   `lib/server/messages/reply-rule.ts`) written strictly after that first
 *   customer message. A reply written in the same instant does not count.
 *   On a converted conversation it can be earlier than the ticket's own
 *   `created_at`.
 *
 * Every write here keeps `tickets.updated_at` as it was: the "recent" ticket
 * list, search ranking, the REST `updatedAfter` sync and the retention clock
 * read it. The update is raw SQL, which the column's `$onUpdate` never sees.
 */
import { db, sql, conversationMessages, ticketConversations } from '@/lib/server/db'
import type { Database, Transaction } from '@/lib/server/db'
import { fromUuid, toUuid, type ConversationId, type TicketId } from '@quackback/ids'
import type { SQL } from 'drizzle-orm'
import { humanReply } from '@/lib/server/messages/reply-rule'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'ticket-first-response' })

type Executor = Database | Transaction

/** One side of the thread: public, undeleted messages matching `parent`. */
function threadRows(parent: SQL): SQL {
  return sql`
    select ${conversationMessages.createdAt} as created_at,
           ${conversationMessages.senderType} = 'visitor' as visitor,
           ${humanReply} as human
    from ${conversationMessages}
    where ${parent}
      and ${conversationMessages.isInternal} = false
      and ${conversationMessages.deletedAt} is null`
}

/**
 * The first-response value of the ticket whose id is `ticketId`, an SQL
 * expression (a column of the outer query). Two index-friendly branches, one
 * per parent, so each reads its own `*_created_idx` index.
 */
export function firstResponseOf(ticketId: SQL): SQL {
  return sql`(
    select min(w.created_at) filter (where w.human and w.created_at > w.first_customer)
    from (
      select u.created_at, u.human,
             min(u.created_at) filter (where u.visitor) over () as first_customer
      from (
        ${threadRows(sql`${conversationMessages.ticketId} = ${ticketId}`)}
        union all
        ${threadRows(sql`${conversationMessages.conversationId} in (
          select ${ticketConversations.conversationId} from ${ticketConversations}
          where ${ticketConversations.ticketId} = ${ticketId}
            and ${ticketConversations.ticketType} = 'customer'
        )`)}
      ) u
    ) w
  )`
}

/**
 * Recompute first response on the tickets `where` selects (a condition on
 * the alias `t`), writing only rows whose value changed. Returns the ids it
 * changed.
 */
export async function recomputeFirstResponseWhere(
  executor: Executor,
  where: SQL
): Promise<TicketId[]> {
  const rows = (await executor.execute(sql`
    update tickets set first_response_at = fr.at
    from (
      select t.id, ${firstResponseOf(sql`t.id`)} as at
      from tickets t
      where ${where}
    ) fr
    where tickets.id = fr.id
      and tickets.first_response_at is distinct from fr.at
    returning tickets.id::text as id
  `)) as unknown as Array<{ id: string }>
  return rows.map((row) => fromUuid('ticket', row.id) as TicketId)
}

/**
 * Recompute one ticket's first response, in `executor`'s transaction when
 * given. True when the value changed; the caller then publishes the ticket
 * (`publishFirstResponseChange`) once its transaction commits.
 */
export async function recomputeTicketFirstResponse(
  ticketId: TicketId,
  executor: Executor = db
): Promise<boolean> {
  const changed = await recomputeFirstResponseWhere(executor, sql`t.id = ${toUuid(ticketId)}::uuid`)
  return changed.length > 0
}

/**
 * Re-render the ticket in every open inbox after its first response changed.
 * Best-effort: the value is already stored, and the next read shows it.
 */
export async function publishFirstResponseChange(ticketId: TicketId): Promise<void> {
  try {
    const [{ loadTicketOr404 }, { publishTicketUpdated }] = await Promise.all([
      import('./ticket.service'),
      import('./ticket-intake.service'),
    ])
    await publishTicketUpdated(await loadTicketOr404(ticketId))
  } catch (err) {
    log.warn({ err, ticket_id: ticketId }, 'ticket first response: realtime publish failed')
  }
}

/** Publish each ticket whose first response changed. */
async function publishChanged(ticketIds: TicketId[]): Promise<void> {
  for (const ticketId of ticketIds) {
    log.debug({ ticket_id: ticketId }, 'ticket first response changed')
    await publishFirstResponseChange(ticketId)
  }
}

/** Recompute one ticket outside any transaction, and publish it when it changed. */
export async function syncTicketFirstResponse(ticketId: TicketId): Promise<void> {
  await publishChanged(await recomputeFirstResponseWhere(db, sql`t.id = ${toUuid(ticketId)}::uuid`))
}

/**
 * The same for the customer ticket paired with a conversation, found in the
 * same statement: one query for a conversation with no paired ticket, which
 * is most of them. Does nothing for such a conversation.
 */
export async function syncPairTicketFirstResponse(conversationId: ConversationId): Promise<void> {
  await publishChanged(
    await recomputeFirstResponseWhere(
      db,
      sql`t.id in (
        select ${ticketConversations.ticketId} from ${ticketConversations}
        where ${ticketConversations.conversationId} = ${toUuid(conversationId)}::uuid
          and ${ticketConversations.ticketType} = 'customer'
      )`
    )
  )
}
