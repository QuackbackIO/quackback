/**
 * Durable workflow-dispatch queue, against a real Postgres.
 *
 * The properties that matter here are database properties, so this suite does
 * not mock the queue: dedupe is a unique index, and the FIFO guarantee is a
 * consequence of the claim asking for exactly one free slot and ordering by
 * insertion. Asserting `concurrency === 1` on a worker option — which is what
 * the BullMQ-mocked version of this file did — only checks that the number I
 * wrote is the number I wrote.
 *
 * Rows are scoped to event ids this file mints, because `DATABASE_URL` points
 * every worktree on this machine at one shared `quackback_test`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  cleanupDedupeKeys,
  cleanupQueues,
  closeHarness,
  ensureJobQueueSchema,
  testDb,
  testSql,
  uniqueQueue,
} from '@/lib/server/jobs/__tests__/harness'
import type { EventData } from '@/lib/server/events/types'

vi.mock('@/lib/server/db', () => ({
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
}))

vi.mock('@/lib/server/workspaces/workspace-context', () => ({
  getCurrentWorkspace: () => null,
}))

const dispatched: EventData[] = []
vi.mock('../event-trigger', () => ({
  dispatchWorkflowsForEvent: async (event: EventData) => {
    dispatched.push(event)
  },
}))

import {
  WORKFLOW_DISPATCH_QUEUE,
  enqueueWorkflowDispatch,
  runWorkflowDispatch,
  workflowDispatchDedupeKey,
} from '../workflow-dispatch-queue'
import { claimJobs, completeJob, enqueueJob, type ClaimedJob } from '@/lib/server/jobs/job-queue'
import { concurrencyFor, findJobDefinition } from '@/lib/server/jobs/definitions'

const RUN = `t${process.pid}${Date.now().toString(36)}`
const keys: string[] = []
const privateQueues: string[] = []

/** A minimally-shaped claimed row, for calling a handler directly. */
function bareJob(): ClaimedJob {
  return {
    id: '0',
    jobId: 'job_probe',
    queue: WORKFLOW_DISPATCH_QUEUE,
    dedupeKey: null,
    payload: {},
    workspaceKey: null,
    attempts: 1,
    maxAttempts: 3,
    leaseToken: '00000000-0000-0000-0000-000000000000',
    lockedUntil: new Date(),
  }
}

function makeEvent(id: string): EventData {
  keys.push(workflowDispatchDedupeKey(id))
  return {
    id,
    type: 'conversation.created',
    timestamp: '2026-01-01T00:00:00Z',
    actor: { type: 'user', userId: 'user_1' },
    data: {
      conversation: { id: 'conversation_1', channel: 'messenger', visitorPrincipalId: null },
    },
  } as unknown as EventData
}

async function rowsForKeys(): Promise<Array<{ dedupe_key: string; status: string; id: string }>> {
  return (await testSql()`
    SELECT id::text, dedupe_key, status FROM job_queue
    WHERE queue = ${WORKFLOW_DISPATCH_QUEUE} AND dedupe_key = ANY(${keys}::text[])
    ORDER BY id
  `) as unknown as Array<{ dedupe_key: string; status: string; id: string }>
}

beforeAll(async () => {
  await ensureJobQueueSchema()
})

afterAll(async () => {
  await cleanupDedupeKeys(WORKFLOW_DISPATCH_QUEUE, keys)
  await cleanupQueues(privateQueues)
  await closeHarness()
})

describe('enqueueWorkflowDispatch', () => {
  it('dedupes on the event id — the thing the BullMQ job id could never do', async () => {
    // `workflow-dispatch:<eventId>` is two colon-separated parts, and bullmq
    // rejects a custom id unless it splits into exactly three: the enqueue threw
    // `Custom Id cannot contain :` on every call, so this dedupe never once
    // happened under the queue it was written for.
    const event = makeEvent(`${RUN}-dup`)
    await enqueueWorkflowDispatch(event)
    await enqueueWorkflowDispatch(event)

    const rows = (await rowsForKeys()).filter((r) => r.dedupe_key.endsWith(`${RUN}-dup`))
    expect(rows).toHaveLength(1)
  })

  it('gives each event its own row', async () => {
    await enqueueWorkflowDispatch(makeEvent(`${RUN}-a`))
    await enqueueWorkflowDispatch(makeEvent(`${RUN}-b`))
    const rows = await rowsForKeys()
    expect(rows.map((r) => r.dedupe_key)).toEqual(
      expect.arrayContaining([
        workflowDispatchDedupeKey(`${RUN}-a`),
        workflowDispatchDedupeKey(`${RUN}-b`),
      ])
    )
  })
})

describe('the ordering constraint', () => {
  it('is declared as concurrency 1 on the definition', () => {
    const def = findJobDefinition(WORKFLOW_DISPATCH_QUEUE)
    expect(def).toBeDefined()
    expect(concurrencyFor(def!)).toBe(1)
  })

  it('hands out one job at a time, oldest first', async () => {
    // The claim is asked for exactly the free slots the SHIPPED definition
    // declares, so raising `concurrency` to 2 makes this test fail rather than
    // silently pass — that is what ties it to the property instead of to a
    // literal. The queue name is private because `quackback_test` is shared
    // across worktrees and the real queue names are fixed.
    const def = findJobDefinition(WORKFLOW_DISPATCH_QUEUE)
    const slots = concurrencyFor(def!)
    const q = uniqueQueue('wf-dispatch-fifo')
    privateQueues.push(q)

    const ids = ['first', 'second', 'third']
    for (const id of ids) {
      await enqueueJob({ queue: q, payload: { event: { id } }, dedupeKey: id, maxAttempts: 3 })
    }

    const seen: string[] = []
    for (let i = 0; i < ids.length; i++) {
      const claimed: ClaimedJob[] = await claimJobs({
        specs: [{ queue: q, limit: slots, leaseMs: 30_000 }],
      })
      expect(claimed).toHaveLength(1)
      seen.push(String((claimed[0].payload as { event: { id: string } }).event.id))
      await completeJob(claimed[0])
    }
    expect(seen).toEqual(ids)
  })
})

describe('runWorkflowDispatch', () => {
  it('dispatches the event the row carried', async () => {
    dispatched.length = 0
    const event = makeEvent(`${RUN}-run`)
    await enqueueWorkflowDispatch(event)
    // Read the row back rather than claiming: `quackback_test` is shared, so a
    // claim on a fixed queue name could hand this test another checkout's job.
    const [row] = (await testSql()`
      SELECT payload FROM job_queue
      WHERE queue = ${WORKFLOW_DISPATCH_QUEUE}
        AND dedupe_key = ${workflowDispatchDedupeKey(`${RUN}-run`)}
    `) as unknown as Array<{ payload: Record<string, unknown> }>
    expect(row).toBeDefined()
    await runWorkflowDispatch({ ...bareJob(), payload: row.payload })
    expect(dispatched.map((e) => e.id)).toEqual([`${RUN}-run`])
  })

  it('treats a row with no event as corrupt rather than retrying it forever', async () => {
    dispatched.length = 0
    await expect(runWorkflowDispatch(bareJob())).resolves.toBeUndefined()
    expect(dispatched).toHaveLength(0)
  })
})
