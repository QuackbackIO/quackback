/**
 * The startup backfill that corrects every ticket's stored first response to
 * the rule in ticket-first-response.ts, and its follow-up.
 *
 * Builds before this rule stamped `first_response_at` on the first status,
 * assignee or priority change, and counted the assistant's replies and a
 * teammate's opening message. The walk recomputes every ticket by id range,
 * writing only rows whose value changed, so a second run changes nothing.
 *
 * During a rolling deploy an older replica can still stamp the old way after
 * the walk has passed a ticket. So the walk enqueues a follow-up, due about an
 * hour later when the overlap has ended, which walks every ticket again with
 * the same step. Message events fix any row it misses after that.
 *
 * Readers tolerate tickets the walk has not reached: they show the old value
 * until then.
 */
import { sql } from 'drizzle-orm'
import { createId, fromUuid, type PrincipalId, type TicketId } from '@quackback/ids'
import { conversationMessages, principal, tickets, type Transaction } from '@/lib/server/db'
import type {
  BackfillDb,
  BackfillFixtureContext,
  BackfillRange,
  BatchedBackfill,
} from '@/lib/server/backfills/batched'
import { recomputeFirstResponseWhere } from './ticket-first-response'

const NAME = 'ticket-frt-recompute'

/** Recompute the tickets in one id range. Raw SQL, so `updated_at` stays. */
async function step(tx: Transaction, { fromId, toId }: BackfillRange): Promise<void> {
  await recomputeFirstResponseWhere(
    tx,
    sql`t.id <= ${toId}::uuid and (${fromId}::uuid is null or t.id > ${fromId}::uuid)`
  )
}

/**
 * Seed two tickets an older build stamped from a status change: one a
 * teammate later answered, whose value must move to that reply, and one never
 * answered, whose value must clear. Returns the check of both.
 */
async function fixture(db: BackfillDb, { ticketUpdatedAt }: BackfillFixtureContext) {
  const marker = `${NAME}-${createId('ticket')}`
  const [status] = (await db.execute(
    sql`SELECT id FROM ticket_statuses WHERE deleted_at IS NULL ORDER BY position LIMIT 1`
  )) as unknown as Array<{ id: string }>
  const customer = createId('principal') as PrincipalId
  const teammate = createId('principal') as PrincipalId
  await db.insert(principal).values([
    { id: customer, role: 'user', type: 'user', createdAt: ticketUpdatedAt },
    { id: teammate, role: 'member', type: 'user', createdAt: ticketUpdatedAt },
  ])

  const stampedAt = new Date(ticketUpdatedAt.getTime() - 3_600_000)
  const askedAt = new Date(ticketUpdatedAt.getTime() - 2 * 3_600_000)
  const repliedAt = new Date(ticketUpdatedAt.getTime() - 1_800_000)
  const ids: Record<'answered' | 'unanswered', TicketId> = {
    answered: createId('ticket') as TicketId,
    unanswered: createId('ticket') as TicketId,
  }
  for (const [label, id] of Object.entries(ids)) {
    await db.insert(tickets).values({
      id,
      title: `${marker}-${label}`,
      statusId: fromUuid('ticket_status', status.id),
      firstResponseAt: stampedAt,
      createdAt: ticketUpdatedAt,
      updatedAt: ticketUpdatedAt,
    })
    await db.insert(conversationMessages).values({
      ticketId: id,
      principalId: customer,
      senderType: 'visitor',
      content: 'help please',
      createdAt: askedAt,
    })
  }
  await db.insert(conversationMessages).values({
    ticketId: ids.answered,
    principalId: teammate,
    senderType: 'agent',
    content: 'on it',
    createdAt: repliedAt,
  })

  return async (check: BackfillDb) => {
    const rows = (await check.execute(sql`
      SELECT title, first_response_at FROM tickets WHERE title LIKE ${`${marker}-%`}
    `)) as unknown as Array<{ title: string; first_response_at: Date | string | null }>
    const at = (label: string) => {
      const value = rows.find((row) => row.title === `${marker}-${label}`)?.first_response_at
      return value == null ? null : new Date(value).getTime()
    }
    return rows.length === 2 && at('answered') === repliedAt.getTime() && at('unanswered') === null
  }
}

export const ticketFirstResponseBackfill: BatchedBackfill = {
  name: NAME,
  // The personal-key exemption reads api_keys.kind.
  requiresMigration: '0309_api_key_kinds',
  table: 'tickets',
  batchSize: 500,
  pauseMs: 50,
  step,
  fixture,
  followUp: {
    queue: 'ticket-frt-reconcile',
    delayMs: 60 * 60_000,
    table: 'tickets',
    batchSize: 500,
    pauseMs: 50,
    step,
    fixture,
  },
}
