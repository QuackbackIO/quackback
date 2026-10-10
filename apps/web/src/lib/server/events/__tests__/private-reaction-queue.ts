/**
 * Test helper: run a test's own `event-reactions` jobs through the real runner
 * and the shipped queue definition, and nothing else.
 *
 * Every suite shares one test database, and a drain claims the oldest
 * claimable rows of each queue the runner has a definition for. A drain of the
 * shipped queue could therefore claim, lock or run a job another suite queued.
 * Instead the test moves its own jobs, by event id, onto a queue name no other
 * suite uses, and scopes the runner to that name with the shipped definition's
 * settings (concurrency, lease, attempts, backoff). The reaction handler reads
 * its own queue constant, not the row's, so the jobs run as they would on the
 * shipped queue. The helper only ever writes rows the test created.
 *
 * Uses the rolled-back fixture transaction; call `release()` in afterEach.
 */
import { randomUUID } from 'node:crypto'
import { testDb } from '@/lib/server/__tests__/db-test-fixture'
import { sql } from '@/lib/server/db'
import { JOB_DEFINITIONS, __setJobDefinitionsForTests } from '@/lib/server/jobs/definitions'
import { drainOnce, runnerConfig } from '@/lib/server/jobs/runner'
import { EVENT_REACTIONS_QUEUE } from '../event-reactions'

export interface PrivateReactionQueue {
  /** The queue name this test's jobs run on. */
  name: string
  /** Move these events' reaction jobs onto the private queue. */
  adopt(eventIds: string[]): Promise<void>
  /** Make an event's job due now, as when a retry's backoff has elapsed. */
  due(eventId: string): Promise<void>
  /** One pass of the real runner over the private queue. */
  drain(): ReturnType<typeof drainOnce>
  /** Restore the runner's shipped definitions. */
  release(): void
}

export function privateReactionQueue(): PrivateReactionQueue {
  const shipped = JOB_DEFINITIONS.find((def) => def.name === EVENT_REACTIONS_QUEUE)
  if (!shipped) throw new Error(`no shipped definition for ${EVENT_REACTIONS_QUEUE}`)
  const name = `${EVENT_REACTIONS_QUEUE}-test-${randomUUID()}`
  __setJobDefinitionsForTests([{ ...shipped, name }])
  return {
    name,
    async adopt(eventIds) {
      if (eventIds.length === 0) return
      await testDb.execute(sql`
        UPDATE job_queue SET queue = ${name}
        WHERE queue = ${EVENT_REACTIONS_QUEUE}
          AND payload->>'eventId' IN (${sql.join(
            eventIds.map((id) => sql`${id}`),
            sql`, `
          )})
      `)
    },
    async due(eventId) {
      await testDb.execute(sql`
        UPDATE job_queue SET run_at = now()
        WHERE queue = ${name} AND payload->>'eventId' = ${eventId}
      `)
    },
    drain: () => drainOnce({ ...runnerConfig(), batchSize: 5 }),
    release: () => __setJobDefinitionsForTests(null),
  }
}
