/**
 * Rolling back to a build that predates the `event-reactions` and
 * `event-summaries` queues (JOBS.md §10, "Rolling back to a build that
 * predates the reaction queues"). A worker without their definitions never
 * claims their rows, so they wait, pending, for the runbook's drain check and
 * purge. This pins that premise against the real runner, and runs the
 * runbook's own SQL, read from JOBS.md, against the real schema. Each
 * statement is narrowed to this test's event so it never touches rows other
 * suites left in the shared database.
 *
 * Real DB (rolled back), real legacy dispatch, outbox and job runner.
 */
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'
import { createId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { events, eq, sql } from '@/lib/server/db'
import { getExecuteRows } from '@/lib/server/utils/execute-rows'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import * as dispatch from '../dispatch'
import { EVENT_REACTIONS_QUEUE, EVENT_SUMMARIES_QUEUE } from '../event-reactions'
import { __setJobDefinitionsForTests, type JobDefinition } from '@/lib/server/jobs/definitions'
import { drainOnce, runnerConfig, resetJobHandlers } from '@/lib/server/jobs/runner'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ owner: events.dispatchOwner }).from(events).limit(0)
  },
})
afterAll(() => fixture.close())

/** The runbook's drain check and purge, as JOBS.md states them. */
const runbook = (() => {
  const doc = readFileSync(path.resolve(__dirname, '../../jobs/JOBS.md'), 'utf8')
  const start = doc.indexOf('**Rolling back to a build that predates the reaction queues.**')
  const section = doc.slice(start, doc.indexOf('\n## ', start))
  const [check, purge] = [...section.matchAll(/```sql\n([\s\S]*?)```/g)].map((match) =>
    match[1].trim().replace(/;$/, '')
  )
  return { check, purge }
})()

/** A runbook statement, narrowed to one event's jobs. */
const forEvent = (statement: string, eventId: string) =>
  sql`${sql.raw(statement)} AND payload->>'eventId' = ${eventId}`

/**
 * The queue set of a worker built before the reaction queues existed. Its one
 * queue is named for this run, so the drain below can claim no other suite's
 * rows.
 */
const OLDER_BUILD: JobDefinition[] = [
  { name: `queue-of-an-older-build-${randomUUID()}`, handler: async () => async () => {} },
]

/** A conversation closed through the legacy dispatch: one job on each reaction queue. */
async function closeConversation(): Promise<string> {
  const conversationId = createId('conversation')
  await dispatch.dispatchConversationStatusChanged(
    { type: 'user', principalId: createId('principal') },
    {
      id: conversationId,
      status: 'closed',
      channel: 'messenger',
      priority: 'medium',
      assignedTeamId: null,
    },
    'open',
    'closed'
  )
  const [row] = await testDb.select().from(events).where(eq(events.entityId, conversationId))
  return row.eventId
}

async function reactionJobs(eventId: string) {
  return getExecuteRows<{ queue: string; status: string; attempts: number }>(
    await testDb.execute(sql`
      SELECT queue, status, attempts FROM job_queue
      WHERE queue IN (${EVENT_REACTIONS_QUEUE}, ${EVENT_SUMMARIES_QUEUE})
        AND payload->>'eventId' = ${eventId}
      ORDER BY queue
    `)
  )
}

describe.skipIf(!fixture.available)('rolling back past the reaction queues', () => {
  beforeEach(() => {
    resetJobHandlers()
    return fixture.begin()
  })
  afterEach(async () => {
    __setJobDefinitionsForTests(null)
    resetJobHandlers()
    await fixture.rollback()
  })

  it('a worker without the reaction queues never claims their jobs', async () => {
    const eventId = await closeConversation()

    __setJobDefinitionsForTests(OLDER_BUILD)
    for (let pass = 0; pass < 3; pass++) await drainOnce({ ...runnerConfig(), batchSize: 5 })

    expect(await reactionJobs(eventId)).toEqual([
      { queue: EVENT_REACTIONS_QUEUE, status: 'pending', attempts: 0 },
      { queue: EVENT_SUMMARIES_QUEUE, status: 'pending', attempts: 0 },
    ])
  })

  it("the runbook's drain check counts those jobs and its purge removes them", async () => {
    const eventId = await closeConversation()
    const count = async () =>
      Number(
        getExecuteRows<{ count: string | number }>(
          await testDb.execute(forEvent(runbook.check, eventId))
        )[0].count
      )

    expect(await count()).toBe(2)
    await testDb.execute(forEvent(runbook.purge, eventId))

    expect(await count()).toBe(0)
    expect(await reactionJobs(eventId)).toEqual([])
  })
})
