/**
 * Binds a close summary to the close that queued it.
 *
 * The summaries run from durable jobs (events/event-summaries-queue.ts) that
 * can run late, retried, or two at once. A job that runs after the
 * conversation or ticket reopened, or after a later close, must not write:
 * its summary would describe a close that is no longer the current one, and
 * an older close finishing last would overwrite the newer close's summary.
 * So the job carries its close (the triggering event: its id and time), and:
 *
 *  - skips before the AI call when that close is no longer current
 *    (isCurrentClose);
 *  - summarizes only the messages written up to the close (upToClose);
 *  - writes only while that close is still current, checked under the entity
 *    row's lock in the write's own transaction, and only while the job's
 *    deadline has not passed (writeForCurrentClose). A reopen or close updates
 *    that row, so none can land between the check and the write; a newer
 *    close's job then writes after this one, never before it; and an attempt
 *    past its deadline, whose retry may already be running, writes nothing.
 */
import {
  db,
  conversations,
  eq,
  sql,
  tickets,
  ticketStatuses,
  type Database,
  type Transaction,
} from '@/lib/server/db'
import type { ConversationId, TicketId } from '@quackback/ids'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'close-summary' })

/** The close a summary job was queued for: its status-change event. */
export interface TriggeringClose {
  eventId: string
  at: Date
}

export type SummarizedEntity = 'conversation' | 'ticket'

/**
 * Whether `close` is still the entity's current close: the entity is closed
 * now, and no close was recorded after it (a later close event, by the
 * events log's insertion order). With `lock`, the entity row is locked first,
 * so it stays that way until the caller's transaction ends.
 */
export async function isCurrentClose(
  entity: SummarizedEntity,
  entityId: string,
  close: TriggeringClose,
  opts: { lock?: boolean; executor?: Database | Transaction } = {}
): Promise<boolean> {
  const executor = opts.executor ?? db
  const status = await currentStatus(executor, entity, entityId, opts.lock ?? false)
  if (status !== 'closed') {
    log.debug(
      { entity, entity_id: entityId, close_event_id: close.eventId },
      'close summary skipped: no longer closed'
    )
    return false
  }
  const [later] = getExecuteRows<{ found: number }>(
    await executor.execute(sql`
      select 1 as found from events later
      where later.entity_type = ${entity}
        and later.entity_id = ${entityId}
        and later.type = ${`${entity}.status_changed`}
        and later.payload ->> 'newStatus' = 'closed'
        and later.id > (select id from events where event_id = ${close.eventId})
      limit 1
    `)
  )
  if (later) {
    log.debug(
      { entity, entity_id: entityId, close_event_id: close.eventId },
      'close summary skipped: closed again since'
    )
    return false
  }
  return true
}

/** The entity's status (a ticket's by category), optionally taking its row lock. */
async function currentStatus(
  executor: Database | Transaction,
  entity: SummarizedEntity,
  entityId: string,
  lock: boolean
): Promise<string | null> {
  if (entity === 'conversation') {
    const query = executor
      .select({ status: conversations.status })
      .from(conversations)
      .where(eq(conversations.id, entityId as ConversationId))
    const [row] = lock ? await query.for('update') : await query
    return row?.status ?? null
  }
  const query = executor
    .select({ status: ticketStatuses.category })
    .from(tickets)
    .innerJoin(ticketStatuses, eq(ticketStatuses.id, tickets.statusId))
    .where(eq(tickets.id, entityId as TicketId))
  const [row] = lock ? await query.for('update', { of: tickets }) : await query
  return row?.status ?? null
}

/** The messages written up to the close. */
export function upToClose<T extends { createdAt: string }>(
  messages: T[],
  close: TriggeringClose
): T[] {
  return messages.filter((message) => Date.parse(message.createdAt) <= close.at.getTime())
}

/**
 * Run `write` in a transaction that first locks the entity row and checks
 * that `close` is still current and `signal` has not aborted. Returns whether
 * it wrote.
 */
export async function writeForCurrentClose(
  entity: SummarizedEntity,
  entityId: string,
  close: TriggeringClose,
  signal: AbortSignal | undefined,
  write: (tx: Transaction) => Promise<void>
): Promise<boolean> {
  return db.transaction(async (tx) => {
    if (!(await isCurrentClose(entity, entityId, close, { lock: true, executor: tx }))) {
      return false
    }
    if (signal?.aborted) {
      log.debug(
        { entity, entity_id: entityId, close_event_id: close.eventId },
        'close summary skipped: past its deadline'
      )
      return false
    }
    await write(tx)
    return true
  })
}
