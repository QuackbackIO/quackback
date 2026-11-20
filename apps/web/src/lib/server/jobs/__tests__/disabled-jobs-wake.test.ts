/**
 * A job wake does not start a paused job.
 *
 * Work is mostly started by id: after commit in this process, or by the web
 * tier's `POST /api/internal/job-wake`. Both land in `handleJobWake`, which
 * claims the named rows directly rather than through the poll. A paused job's
 * row must stay pending on that path too, and run on a wake once the pause is
 * lifted.
 *
 * The real worker, single-workspace, on real Postgres.
 */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { cleanupQueues, closeHarness, rowsFor, testDb, uniqueQueue } from './harness'

vi.hoisted(() => {
  if (!process.env.BASE_URL?.startsWith('http')) process.env.BASE_URL = 'http://localhost:3000'
  process.env.SECRET_KEY ??= 'test-secret-key-for-job-wake-pause-0123456789'
  // The loop's own poll stays out of the way: what runs, the wake started.
  process.env.JOB_POLL_INTERVAL_MS = '600000'
})

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
vi.mock('@/lib/server/logger', () => {
  const quiet = { info() {}, warn() {}, error() {}, debug() {}, child: () => quiet }
  return { logger: quiet }
})
vi.mock('@/lib/server/events/event-dispatch-queue', () => ({
  convertRelayOwnedEvents: async () => ({ converted: 0, enqueued: 0 }),
}))

import { __setJobDefinitionsForTests } from '../definitions'
import { enqueueJob } from '../job-queue'
import { handleJobWake, startJobWorker, stopJobWorker } from '../worker'

const ENV = 'QUACKBACK_DISABLED_JOBS'
const created: string[] = []

afterEach(async () => {
  await stopJobWorker()
  delete process.env[ENV]
  __setJobDefinitionsForTests(null)
})

afterAll(async () => {
  await cleanupQueues(created)
  await closeHarness()
})

describe('a job wake', () => {
  it('leaves a paused job pending, and runs it once the pause is lifted', async () => {
    const q = uniqueQueue('wake-paused')
    created.push(q)
    const ran: string[] = []
    __setJobDefinitionsForTests([
      { name: q, handler: async () => async (job) => void ran.push(job.jobId) },
    ])
    process.env[ENV] = q
    await startJobWorker()

    // Enqueueing outside a transaction already rings the in-process wake.
    const { jobId } = await enqueueJob({ queue: q })
    await handleJobWake({ workspaceKey: '_', jobIds: [jobId] })
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(ran).toEqual([])
    expect((await rowsFor(q))[0]).toMatchObject({ status: 'pending', attempts: 0 })

    delete process.env[ENV]
    await handleJobWake({ workspaceKey: '_', jobIds: [jobId] })
    await vi.waitFor(() => expect(ran).toEqual([jobId]), { timeout: 5_000 })
  })
})
