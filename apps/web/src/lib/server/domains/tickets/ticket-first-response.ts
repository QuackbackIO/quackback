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
import { db, and, eq, sql, conversationMessages, ticketConversations } from '@/lib/server/db'
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

/** The same, in a transaction of its own unless `executor` is one already. */
export function recomputeFirstResponseWhere(
  executor: Executor,
  where: SQL
): Promise<FirstResponseChange[]> {
  return executor === db
    ? db.transaction((tx) => recomputeFirstResponseIn(tx, where))
    : recomputeFirstResponseIn(executor as Transaction, where)
}

/**
 * Recompute one ticket's first response, in `executor`'s transaction when
 * given. Returns the change, or null when the value stayed; the caller then
 * publishes the ticket (`publishFirstResponseChange`) once its transaction
 * commits.
 */
export async function recomputeTicketFirstResponse(
  ticketId: TicketId,
  executor: Executor = db
): Promise<FirstResponseChange | null> {
  const [change] = await recomputeFirstResponseWhere(
    executor,
    sql`t.id = ${toUuid(ticketId)}::uuid`
  )
  return change ?? null
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

/** Publish every ticket whose first response changed, together. */
async function publishChanged(changes: FirstResponseChange[]): Promise<void> {
  await Promise.all(
    changes.map((change) => {
      log.debug({ ticket_id: change.id }, 'ticket first response changed')
      return publishFirstResponseChange(change.id)
    })
  )
}

/** Recompute one ticket in a transaction of its own, and publish it when it changed. */
export async function syncTicketFirstResponse(ticketId: TicketId): Promise<void> {
  await publishChanged(await recomputeFirstResponseWhere(db, sql`t.id = ${toUuid(ticketId)}::uuid`))
}

/**
 * The same for the customer ticket paired with a conversation. The pair is
 * read first, so a conversation with no paired ticket, which is most of them,
 * costs that one indexed read and nothing else.
 */
export async function syncPairTicketFirstResponse(conversationId: ConversationId): Promise<void> {
  const [pair] = await db
    .select({ ticketId: ticketConversations.ticketId })
    .from(ticketConversations)
    .where(
      and(
        eq(ticketConversations.conversationId, conversationId),
        eq(ticketConversations.ticketType, 'customer')
      )
    )
    .limit(1)
  if (pair) await syncTicketFirstResponse(pair.ticketId as TicketId)
}
