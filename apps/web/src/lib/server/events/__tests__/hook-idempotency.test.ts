/**
 * Hook idempotency unit tests.
 *
 * Exercises the claim/complete/fail/release lease primitives with a mocked
 * DB — the integration angle (real Postgres ON CONFLICT semantics, the
 * stale-lease reclaim window) is exercised by the migration applying
 * cleanly + the unique PK on job_id, which Drizzle enforces at the schema
 * level.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock is hoisted, so the factory can't close over module-level
// consts. Stash the mocks on globalThis instead so the test body can
// drive them.
vi.mock('@/lib/server/db', () => {
  const execute = vi.fn()
  const update = vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })) }))
  const del = vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) }))
  ;(globalThis as Record<string, unknown>).__hookMocks = {
    execute,
    update,
    delete: del,
  }
  return {
    db: { execute, update, delete: del },
    hookDeliveries: { jobId: 'job_id', outcome: 'outcome', processedAt: 'processed_at' },
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
    eq: vi.fn(),
  }
})

import {
  claimHookDelivery,
  completeHookDelivery,
  failHookDelivery,
  releaseHookDelivery,
} from '../hook-idempotency'

interface HookMocks {
  execute: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
}

function getMocks(): HookMocks {
  return (globalThis as Record<string, unknown>).__hookMocks as HookMocks
}

describe('claimHookDelivery', () => {
  beforeEach(() => {
    const m = getMocks()
    m.execute.mockReset()
    m.update.mockClear()
    m.delete.mockClear()
  })

  it('returns true on first claim (insert succeeded)', async () => {
    const m = getMocks()
    m.execute.mockResolvedValueOnce([{ job_id: 'job_1' }])
    const claimed = await claimHookDelivery('job_1', 'webhook')
    expect(claimed).toBe(true)
    expect(m.execute).toHaveBeenCalledOnce()
    expect(m.execute.mock.calls[0][0].values).toEqual(['job_1', 'webhook'])
  })

  it('returns false on second claim (conflict, no row returned)', async () => {
    const m = getMocks()
    m.execute.mockResolvedValueOnce([])
    const claimed = await claimHookDelivery('job_1', 'webhook')
    expect(claimed).toBe(false)
  })

  it('passes through for missing jobId (test/ad-hoc paths)', async () => {
    const m = getMocks()
    const claimed = await claimHookDelivery(undefined, 'webhook')
    expect(claimed).toBe(true)
    expect(m.execute).not.toHaveBeenCalled()
  })

  it('records the hookType so retention sweeps can target one hook', async () => {
    const m = getMocks()
    m.execute.mockResolvedValueOnce([{ job_id: 'job_2' }])
    await claimHookDelivery('job_2', 'ai')
    expect(m.execute.mock.calls[0][0].values).toEqual(['job_2', 'ai'])
  })

  // The stale-lease reclaim itself is a Postgres WHERE-clause behavior (a
  // real 'processing' row older than 5 minutes gets overwritten by the
  // ON CONFLICT ... DO UPDATE), which a mocked db.execute can't exercise
  // end-to-end. What's practical to lock in here is that the query text
  // still carries the reclaim window, so a refactor can't silently drop it.
  it('gates the ON CONFLICT reclaim on a 5-minute stale "processing" lease', async () => {
    const m = getMocks()
    m.execute.mockResolvedValueOnce([{ job_id: 'job_3' }])
    await claimHookDelivery('job_3', 'webhook')
    const queryText = (m.execute.mock.calls[0][0].strings as string[]).join('')
    expect(queryText).toContain("outcome = 'processing'")
    expect(queryText).toContain("interval '5 minutes'")
  })
})

describe('completeHookDelivery / failHookDelivery / releaseHookDelivery', () => {
  beforeEach(() => {
    const m = getMocks()
    m.execute.mockReset()
    m.update.mockClear()
    m.delete.mockClear()
  })

  it('completeHookDelivery marks the row completed', async () => {
    const m = getMocks()
    await completeHookDelivery('job_1')
    expect(m.update).toHaveBeenCalledOnce()
  })

  it('failHookDelivery marks the row failed (terminal — kept for dedupe)', async () => {
    const m = getMocks()
    await failHookDelivery('job_1')
    expect(m.update).toHaveBeenCalledOnce()
  })

  it('releaseHookDelivery deletes the row so a retry can re-claim it', async () => {
    const m = getMocks()
    await releaseHookDelivery('job_1')
    expect(m.delete).toHaveBeenCalledOnce()
  })

  it('all three are no-ops for a missing jobId', async () => {
    const m = getMocks()
    await completeHookDelivery(undefined)
    await failHookDelivery(undefined)
    await releaseHookDelivery(undefined)
    expect(m.update).not.toHaveBeenCalled()
    expect(m.delete).not.toHaveBeenCalled()
  })
})
