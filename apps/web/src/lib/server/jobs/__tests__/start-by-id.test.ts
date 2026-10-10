/**
 * Start-by-id vs the poller: the claim lock and reservation release.
 *
 * These paths are control-flow, not SQL. `claimJobs` / `claimById` are
 * deferred so the race is deterministic; the pool and caps are the real ones.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const queueMocks = vi.hoisted(() => ({
  claimJobs: vi.fn(),
  claimById: vi.fn(),
  peekRunnableJob: vi.fn(),
}))

vi.mock('../job-queue', async (original) => ({
  ...(await original<typeof import('../job-queue')>()),
  claimJobs: (...args: unknown[]) => queueMocks.claimJobs(...args),
  claimById: (...args: unknown[]) => queueMocks.claimById(...args),
  peekRunnableJob: (...args: unknown[]) => queueMocks.peekRunnableJob(...args),
}))

vi.mock('@/lib/server/db', () => ({ db: {} }))

vi.mock('@/lib/server/logger', () => {
  const stub = {
    info() {},
    warn() {},
    error() {},
    debug() {},
    child() {
      return stub
    },
  }
  return { logger: stub }
})

import { __setJobDefinitionsForTests } from '../definitions'
import type { ClaimedJob } from '../job-queue'
import {
  awaitPool,
  createJobPool,
  dispatchPass,
  poolSize,
  resetJobHandlers,
  runnerConfig,
  startJobsById,
} from '../runner'

const CONFIG = { ...runnerConfig(), batchSize: 10, maxConcurrency: 4 }
const QUEUE = 'start-by-id-lock'

function fakeJob(jobId: string): ClaimedJob {
  return {
    id: jobId,
    jobId,
    queue: QUEUE,
    dedupeKey: null,
    payload: {},
    workspaceKey: null,
    attempts: 1,
    maxAttempts: 1,
    leaseToken: 'lease',
    lockedUntil: new Date(),
    runAt: new Date(),
  }
}

afterEach(() => {
  __setJobDefinitionsForTests(null)
  resetJobHandlers()
  queueMocks.claimJobs.mockReset()
  queueMocks.claimById.mockReset()
  queueMocks.peekRunnableJob.mockReset()
})

describe('start-by-id vs the poller', () => {
  it('does not let start-by-id claim while a poll pass is still claiming', async () => {
    __setJobDefinitionsForTests([
      { name: QUEUE, concurrency: 1, handler: async () => async () => {} },
    ])

    let releaseClaim!: () => void
    const gate = new Promise<void>((resolve) => {
      releaseClaim = resolve
    })
    let entered = 0
    queueMocks.claimJobs.mockImplementation(async () => {
      entered += 1
      await gate
      return [fakeJob('poll')]
    })
    queueMocks.peekRunnableJob.mockResolvedValue({ queue: QUEUE })
    queueMocks.claimById.mockResolvedValue(fakeJob('by-id'))

    let releaseRun!: () => void
    const hang = new Promise<void>((resolve) => {
      releaseRun = resolve
    })
    const run = async () => {
      await hang
      return 'succeeded' as const
    }

    const pool = createJobPool()
    const dispatch = dispatchPass({ pool, config: CONFIG, run })
    await vi.waitFor(() => expect(entered).toBe(1))

    const byId = startJobsById({ pool, config: CONFIG, jobIds: ['by-id'], run })
    await new Promise((r) => setTimeout(r, 50))
    expect(poolSize(pool)).toBe(0)
    expect(queueMocks.peekRunnableJob).not.toHaveBeenCalled()
    expect(queueMocks.claimById).not.toHaveBeenCalled()

    releaseClaim()
    const [dispatchResult, byIdResult] = await Promise.all([dispatch, byId])
    expect(dispatchResult.claimed).toBe(1)
    expect(byIdResult).toBe(0)
    expect(poolSize(pool)).toBe(1)
    expect(queueMocks.claimById).not.toHaveBeenCalled()

    releaseRun()
    await awaitPool(pool)
    expect(poolSize(pool)).toBe(0)
  })

  it('releases the reserved slot when claimById throws', async () => {
    __setJobDefinitionsForTests([
      { name: QUEUE, concurrency: 1, handler: async () => async () => {} },
    ])
    queueMocks.peekRunnableJob.mockResolvedValue({ queue: QUEUE })
    queueMocks.claimById.mockRejectedValueOnce(new Error('claim exploded'))

    const pool = createJobPool()
    await expect(
      startJobsById({
        pool,
        config: CONFIG,
        jobIds: ['job_1'],
        run: async () => 'succeeded',
      })
    ).rejects.toThrow('claim exploded')
    expect(poolSize(pool)).toBe(0)

    queueMocks.claimById.mockResolvedValueOnce(fakeJob('job_1'))
    const claimed = await startJobsById({
      pool,
      config: CONFIG,
      jobIds: ['job_1'],
      run: async () => 'succeeded',
    })
    expect(claimed).toBe(1)
    await awaitPool(pool)
    expect(poolSize(pool)).toBe(0)
  })
})
