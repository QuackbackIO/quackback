/**
 * The fleet cap rule for heavy and fleet-wide jobs.
 *
 * A job that walks a large table, builds an index or runs in every workspace
 * sets `fleetConcurrency` (2 to 4) and `retryBackoffMs`, so a fleet upgrade
 * runs a few workspaces at a time and a retry after a database restart does not
 * arrive with every other one. Measured: an hourly job the whole fleet ran in
 * one minute took the database out of memory (JOBS.md §6).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const claims = vi.hoisted(
  () => [] as Array<{ specs: Array<{ queue: string; limit: number }>; resolve: () => void }>
)

vi.mock('@/lib/server/logger', () => {
  const quiet = { info() {}, warn() {}, error() {}, debug() {}, child: () => quiet }
  return { logger: quiet }
})
vi.mock('@/lib/server/workspaces/workspace-context', () => ({ getCurrentWorkspace: () => null }))
vi.mock('../job-queue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../job-queue')>()),
  // A claim held in flight, as every workspace loop's is when they start together.
  claimJobs: (input: { specs: Array<{ queue: string; limit: number }> }) =>
    new Promise<never[]>((resolve) => {
      claims.push({
        specs: input.specs.map(({ queue, limit }) => ({ queue, limit })),
        resolve: () => resolve([]),
      })
    }),
}))

import { JOB_DEFINITIONS, __setJobDefinitionsForTests } from '../definitions'
import { createJobPool, dispatchPass, runnerConfig } from '../runner'

/** The heavy or fleet-wide jobs the upgrade work adds. */
const UPGRADE_JOBS = ['startup-backfill', 'ticket-frt-reconcile', 'deferred-index-build']

afterEach(() => {
  for (const claim of claims.splice(0)) claim.resolve()
  __setJobDefinitionsForTests(null)
})

describe('the upgrade jobs', () => {
  it.each(UPGRADE_JOBS)('%s caps its runs across the fleet and backs off its retries', (name) => {
    const def = JOB_DEFINITIONS.find((d) => d.name === name)
    expect(def, name).toBeDefined()
    expect(def!.fleetConcurrency).toBeGreaterThanOrEqual(2)
    expect(def!.fleetConcurrency).toBeLessThanOrEqual(4)
    expect(def!.retryBackoffMs).toBeGreaterThan(0)
  })

  it('retry as the rule says: the walks about twenty times, an index build five', () => {
    const attempts = Object.fromEntries(
      UPGRADE_JOBS.map((name) => [name, JOB_DEFINITIONS.find((d) => d.name === name)?.maxAttempts])
    )
    expect(attempts).toEqual({
      'startup-backfill': 20,
      'ticket-frt-reconcile': 20,
      'deferred-index-build': 5,
    })
  })

  it.each(UPGRADE_JOBS)('%s runs in at most two workspaces at once', async (name) => {
    // An uncapped queue beside it, so every poll still sends a claim.
    __setJobDefinitionsForTests([
      ...JOB_DEFINITIONS.filter((d) => d.name === name),
      { name: 'light', concurrency: 5, handler: async () => async () => {} },
    ])
    const config = { ...runnerConfig(), batchSize: 10, maxConcurrency: 50 }

    // Three workspaces, each with this queue's row pending, poll together.
    for (let i = 0; i < 3; i++) {
      void dispatchPass({ pool: createJobPool(), config, run: async () => 'succeeded' })
      await vi.waitFor(() => expect(claims.length).toBe(i + 1))
    }
    const asked = claims.map((c) => c.specs.find((s) => s.queue === name)?.limit ?? 0)
    expect(asked).toEqual([1, 1, 0])
  })
})
