/**
 * The startup backfill that corrects stored first responses, and the follow-up
 * it enqueues for the rolling-deploy window.
 *
 * Real Postgres and real commits, like the shared backfill suite: the walk
 * runs its own short transactions. The backfill runs under a name of its own
 * (with small batches) so this suite shares no lock, cursor or marker with the
 * registered one. Every message carries an explicit time.
 */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import {
  createId,
  fromUuid,
  toUuid,
  type PrincipalId,
  type TicketId,
  type TicketStatusId,
} from '@quackback/ids'
import { closeHarness } from '@/lib/server/jobs/__tests__/harness'

vi.mock('@/lib/server/db', async (importOriginal) => {
  const { testDb } = await import('@/lib/server/jobs/__tests__/harness')
  return {
    ...(await importOriginal<typeof import('@/lib/server/db')>()),
    db: new Proxy(
      {},
      {
        get(_t, prop) {
          const handle = testDb()
          const value = Reflect.get(handle as object, prop, handle)
          return typeof value === 'function' ? value.bind(handle) : value
        },
      }
    ),
  }
})

import { conversationMessages, principal, tickets, type Transaction } from '@/lib/server/db'
import {
  __setBackfillsForTests,
  findBackfill,
  walkBackfill,
  walkFollowUp,
  walkKeys,
  type BackfillRange,
  type BatchedBackfill,
} from '@/lib/server/backfills/batched'
import {
  cleanupBackfill,
  testDb,
  testSql,
  uniqueName,
} from '@/lib/server/backfills/__tests__/harness'
import { ticketFirstResponseBackfill } from '../ticket-first-response.backfill'

const names: string[] = []
const EDITED = new Date('2025-02-03T04:05:06.789Z')
const STAMPED = new Date('2025-02-03T00:00:00.000Z')
const at = (minute: number) => new Date(Date.UTC(2025, 1, 2, 9, minute))

afterEach(() => __setBackfillsForTests(null))
afterAll(async () => {
  for (const name of names) await cleanupBackfill(name)
  await closeHarness()
})

/**
 * A copy of the registered backfill under its own name, two tickets a batch.
 * `afterBatch` runs after each batch of the walk (not the follow-up) commits
 * its step, inside the batch transaction.
 */
function backfillNamed(label: string, afterBatch?: (range: BackfillRange) => Promise<void>) {
  const name = uniqueName(label)
  names.push(name)
  const base = ticketFirstResponseBackfill
  const entry: BatchedBackfill = {
    ...base,
    name,
    batchSize: 2,
    pauseMs: 0,
    step: async (tx: Transaction, range: BackfillRange) => {
      await base.step(tx, range)
      await afterBatch?.(range)
    },
    followUp: { ...base.followUp!, batchSize: 2, pauseMs: 0 },
  }
  __setBackfillsForTests([entry])
  return entry
}

/**
 * Six tickets an older build stamped from a status change, last edited at
 * `EDITED`. The customer writes on each; a teammate answers the even ones.
 */
async function seed(name: string): Promise<Array<{ id: TicketId; expected: Date | null }>> {
  const [status] = await testSql()<{ id: string }[]>`
    SELECT id::text FROM ticket_statuses WHERE deleted_at IS NULL ORDER BY position LIMIT 1
  `
  const customer = createId('principal') as PrincipalId
  const teammate = createId('principal') as PrincipalId
  await testDb()
    .insert(principal)
    .values([
      { id: customer, role: 'user', type: 'user', createdAt: EDITED },
      { id: teammate, role: 'member', type: 'user', createdAt: EDITED },
    ])
  const seeded: Array<{ id: TicketId; expected: Date | null }> = []
  for (let i = 0; i < 6; i++) {
    const id = createId('ticket') as TicketId
    await testDb()
      .insert(tickets)
      .values({
        id,
        title: `${name}-${i}`,
        statusId: fromUuid('ticket_status', status.id) as TicketStatusId,
        firstResponseAt: STAMPED,
        createdAt: EDITED,
        updatedAt: EDITED,
      })
    await testDb()
      .insert(conversationMessages)
      .values({
        ticketId: id,
        principalId: customer,
        senderType: 'visitor',
        content: 'help',
        createdAt: at(0),
      })
    const answered = i % 2 === 0
    if (answered) {
      await testDb()
        .insert(conversationMessages)
        .values({
          ticketId: id,
          principalId: teammate,
          senderType: 'agent',
          content: 'on it',
          createdAt: at(10 + i),
        })
    }
    seeded.push({ id, expected: answered ? at(10 + i) : null })
  }
  return seeded
}

/** Each seeded ticket's first response and edit time (epoch ms), and its row version. */
async function stateOf(name: string) {
  return testSql()<{ first_response_at: number | null; updated_at: number; xmin: string }[]>`
    SELECT (extract(epoch FROM first_response_at) * 1000)::float8 AS first_response_at,
           (extract(epoch FROM updated_at) * 1000)::float8 AS updated_at,
           xmin::text AS xmin
    FROM tickets WHERE title LIKE ${`${name}-%`} ORDER BY title
  `
}

/** Stamp a ticket the way an older replica does, from a connection of its own. */
async function oldReplicaStamps(id: TicketId): Promise<void> {
  await testSql()`UPDATE tickets SET first_response_at = ${STAMPED.toISOString()} WHERE id = ${toUuid(id)}::uuid`
}

/** Forget a walk's cursor and done marker, so it walks again from the start. */
async function cleanupWalkState(name: string): Promise<void> {
  const keys = Object.values(walkKeys(name))
  await testSql()`DELETE FROM kv_store WHERE key = ANY(${keys}::text[])`
}

describe('the ticket first-response backfill', () => {
  it('corrects every walked ticket, keeps updated_at, enqueues the follow-up, and a rerun writes nothing', async () => {
    const entry = backfillNamed('frt-walk')
    const seeded = await seed(entry.name)

    await walkBackfill(entry)

    const after = await stateOf(entry.name)
    expect(after.map((row) => row.first_response_at)).toEqual(
      seeded.map((row) => row.expected?.getTime() ?? null)
    )
    expect(after.map((row) => row.updated_at)).toEqual(after.map(() => EDITED.getTime()))

    const followUps = await testSql()<{ dedupe_key: string; run_at: Date }[]>`
      SELECT dedupe_key, run_at FROM job_queue
      WHERE queue = 'ticket-frt-reconcile' AND dedupe_key LIKE ${`%:${entry.name}:%`}
    `
    expect(followUps.map((row) => row.dedupe_key)).toEqual([`ticket-frt-reconcile:${entry.name}:1`])
    const dueIn = new Date(followUps[0].run_at).getTime() - Date.now()
    expect(dueIn).toBeGreaterThan(55 * 60_000)
    expect(dueIn).toBeLessThanOrEqual(60 * 60_000)

    // A second walk over the same rows writes none of them: no new row versions.
    await cleanupWalkState(entry.name)
    await walkBackfill(entry)
    const again = await stateOf(entry.name)
    expect(again.map((row) => row.xmin)).toEqual(after.map((row) => row.xmin))
  })

  it('the follow-up fixes what older replicas stamped during and after the walk', async () => {
    let early: TicketId | null = null
    let stampedDuringWalk = false
    const entry = backfillNamed('frt-replica', async (range) => {
      // Once the walk has moved past the first seeded ticket, an older replica
      // stamps it again.
      if (early && !stampedDuringWalk && range.fromId !== null && range.fromId >= toUuid(early)) {
        stampedDuringWalk = true
        await oldReplicaStamps(early)
      }
    })
    const seeded = await seed(entry.name)
    early = seeded[0].id

    await walkBackfill(entry)
    expect(stampedDuringWalk).toBe(true)
    // After the walk ends, another stamp lands on the last ticket.
    await oldReplicaStamps(seeded[5].id)
    const stale = await stateOf(entry.name)
    expect(stale[0].first_response_at).toBe(STAMPED.getTime())
    expect(stale[5].first_response_at).toBe(STAMPED.getTime())

    await walkFollowUp(findBackfill(entry.name)!)

    const fixed = await stateOf(entry.name)
    expect(fixed.map((row) => row.first_response_at)).toEqual(
      seeded.map((row) => row.expected?.getTime() ?? null)
    )
  })
})
