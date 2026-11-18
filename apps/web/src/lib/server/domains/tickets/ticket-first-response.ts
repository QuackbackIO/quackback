/**
 * A ticket's first response (`tickets.first_response_at`): when a teammate
 * first replied to the customer.
 *
 * It is worked out from the message rows, never stamped by an action, so it
 * does not depend on the order writes or queued jobs run in:
 *
 * - Only a customer ticket has one. Back-office and tracker tickets have no
 *   customer, whoever filed them, so theirs is always empty.
 * - The thread is the ticket's own messages, plus, on a customer ticket paired
 *   with a conversation, that conversation's messages. A provenance link adds
 *   nothing.
 * - Only public, undeleted messages count.
 * - The clock starts at the customer's first message (`sender_type =
 *   'visitor'`). A ticket the customer has not written on has no first
 *   response, so a teammate's opening message, or anything a teammate writes
 *   before the customer does, never counts.
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
import {
  db,
  and,
  eq,
  sql,
  conversationMessages,
  ticketConversations,
  tickets,
} from '@/lib/server/db'
import type { Ticket, Transaction } from '@/lib/server/db'
import { fromUuid, toUuid, type ConversationId, type TicketId } from '@quackback/ids'
import type { SQL } from 'drizzle-orm'
import { humanReply } from '@/lib/server/messages/reply-rule'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'ticket-first-response' })

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
 * The first-response value of the ticket whose id is `ticketId` and whose type
 * is `ticketType`, both SQL expressions (columns of the outer query). Null for
 * any ticket that is not a customer ticket. Two index-friendly branches, one
 * per parent, so each reads its own `*_created_idx` index.
 */
export function firstResponseOf(ticketId: SQL, ticketType: SQL): SQL {
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
    where ${ticketType} = 'customer'
  )`
}

/** A ticket whose first response a recompute changed, and its new value. */
export interface FirstResponseChange {
  id: TicketId
  firstResponseAt: Date | null
}

/**
 * Recompute first response on the tickets `where` selects (a condition on the
 * alias `t`) inside `tx`, writing only rows whose value changed.
 *
 * The rows are locked first (`FOR UPDATE`, in id order), and the value is
 * worked out by the next statement. Under read committed each statement reads
 * what was committed when it starts, so a recompute that waited for the lock
 * sees every message the holder committed. Two recomputes of one ticket run
 * one after the other, and the later one never writes a value the earlier one
 * had already outdated.
 */
export async function recomputeFirstResponseIn(
  tx: Transaction,
  where: SQL
): Promise<FirstResponseChange[]> {
  const locked = (await tx.execute(sql`
    select t.id::text as id from tickets t where ${where} order by t.id for update of t
  `)) as unknown as Array<{ id: string }>
  if (locked.length === 0) return []
  const ids = sql.join(
    locked.map((row) => sql`${row.id}::uuid`),
    sql`, `
  )
  const rows = (await tx.execute(sql`
    update tickets set first_response_at = fr.at
    from (
      select t.id, ${firstResponseOf(sql`t.id`, sql`t.type`)} as at
      from tickets t
      where t.id in (${ids})
    ) fr
    where tickets.id = fr.id
      and tickets.first_response_at is distinct from fr.at
    returning tickets.id::text as id, fr.at as at
  `)) as unknown as Array<{ id: string; at: Date | string | null }>
  return rows.map((row) => ({
    id: fromUuid('ticket', row.id) as TicketId,
    firstResponseAt: row.at === null ? null : new Date(row.at),
  }))
}

/**
 * Recompute one ticket's first response, in `tx` when given, else in a
 * transaction of its own: the lock and the update always share one. Returns
 * the change, or null when the value stayed.
 */
export function recomputeTicketFirstResponse(
  ticketId: TicketId,
  tx?: Transaction
): Promise<FirstResponseChange | null> {
  const run = async (t: Transaction) => {
    const [change] = await recomputeFirstResponseIn(t, sql`t.id = ${toUuid(ticketId)}::uuid`)
    return change ?? null
  }
  return tx ? run(tx) : db.transaction(run)
}

/**
 * Whether adding or removing a message written at `messageAt` can move a first
 * response that is now `current`. An internal note never can. Once the value
 * is set, a message written after it cannot: an added one is not earlier than
 * the first reply, and a removed one is not the first reply or anything before
 * it. A removal that changed no row moves nothing either; callers skip it.
 */
export function messageCanMoveFirstResponse(
  current: Date | null,
  message: { createdAt: Date; isInternal: boolean },
  change: 'added' | 'removed'
): boolean {
  if (message.isInternal) return false
  if (current === null) return true
  const at = message.createdAt.getTime()
  return change === 'added' ? at < current.getTime() : at <= current.getTime()
}

/**
 * Re-render a ticket in every open inbox after its first response changed,
 * from the row the caller holds. Fire-and-forget: the value is already
 * stored, so a failed publish is logged and the next read shows it.
 */
export function publishFirstResponseChange(ticket: Ticket): void {
  void import('./ticket-intake.service')
    .then(({ publishTicketUpdated }) => publishTicketUpdated(ticket))
    .catch((err: unknown) => {
      log.warn({ err, ticket_id: ticket.id }, 'ticket first response: realtime publish failed')
    })
}

/**
 * Recompute one ticket in a transaction of its own, and publish it when it
 * changed. The changed row is read in the same transaction, so the publish
 * needs no second read.
 */
export async function syncTicketFirstResponse(ticketId: TicketId): Promise<void> {
  const changed = await db.transaction(async (tx) => {
    const [change] = await recomputeFirstResponseIn(tx, sql`t.id = ${toUuid(ticketId)}::uuid`)
    if (!change) return null
    const [row] = await tx.select().from(tickets).where(eq(tickets.id, ticketId))
    return row ?? null
  })
  if (changed) {
    log.debug({ ticket_id: ticketId }, 'ticket first response changed')
    publishFirstResponseChange(changed)
  }
}

/**
 * The same after a message was removed from a ticket's own thread: skipped
 * when the removal cannot move the value (`messageCanMoveFirstResponse`).
 */
export async function syncTicketFirstResponseAfterRemoval(
  ticketId: TicketId,
  message: { createdAt: Date; isInternal: boolean }
): Promise<void> {
  if (message.isInternal) return
  const [row] = await db
    .select({ firstResponseAt: tickets.firstResponseAt })
    .from(tickets)
    .where(eq(tickets.id, ticketId))
  if (!row || !messageCanMoveFirstResponse(row.firstResponseAt, message, 'removed')) return
  await syncTicketFirstResponse(ticketId)
}

/** The customer ticket paired with a conversation, if any: one indexed read. */
async function pairTicketOf(conversationId: ConversationId) {
  const [pair] = await db
    .select({ ticketId: tickets.id, firstResponseAt: tickets.firstResponseAt })
    .from(ticketConversations)
    .innerJoin(tickets, eq(tickets.id, ticketConversations.ticketId))
    .where(
      and(
        eq(ticketConversations.conversationId, conversationId),
        eq(ticketConversations.ticketType, 'customer')
      )
    )
    .limit(1)
  return pair
    ? { ticketId: pair.ticketId as TicketId, firstResponseAt: pair.firstResponseAt }
    : null
}

/**
 * The same for the customer ticket paired with a conversation. The pair is
 * read first, so a conversation with no paired ticket, which is most of them,
 * costs that one indexed read and nothing else. With `message` (what was added
 * or removed), a change that cannot move the value is skipped too.
 */
export async function syncPairTicketFirstResponse(
  conversationId: ConversationId,
  message?: { createdAt: Date; isInternal: boolean; change: 'added' | 'removed' }
): Promise<void> {
  const pair = await pairTicketOf(conversationId)
  if (!pair) return
  if (message && !messageCanMoveFirstResponse(pair.firstResponseAt, message, message.change)) return
  await syncTicketFirstResponse(pair.ticketId)
}
