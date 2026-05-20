/**
 * Hook idempotency unit tests.
 *
 * Exercises the claimHookDelivery dedup primitive with a mocked DB —
 * the integration angle (real Postgres ON CONFLICT semantics) is
 * exercised by the migration applying cleanly + the unique PK on
 * job_id, which Drizzle enforces at the schema level.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock is hoisted, so the factory can't close over module-level
// consts. Stash the mocks on globalThis instead so the test body can
// drive them.
vi.mock('@/lib/server/db', () => {
  const returning = vi.fn()
  const onConflictDoNothing = vi.fn(() => ({ returning }))
  const values = vi.fn(() => ({ onConflictDoNothing }))
  const insert = vi.fn(() => ({ values }))
  ;(globalThis as Record<string, unknown>).__hookMocks = {
    insert,
    values,
    onConflictDoNothing,
    returning,
  }
  return {
    db: { insert },
    hookDeliveries: { jobId: 'job_id' },
  }
})

import { claimHookDelivery } from '../hook-idempotency'

interface HookMocks {
  insert: ReturnType<typeof vi.fn>
  values: ReturnType<typeof vi.fn>
  onConflictDoNothing: ReturnType<typeof vi.fn>
  returning: ReturnType<typeof vi.fn>
}

function getMocks(): HookMocks {
  return (globalThis as Record<string, unknown>).__hookMocks as HookMocks
}

describe('claimHookDelivery', () => {
  beforeEach(() => {
    const m = getMocks()
    m.insert.mockClear()
    m.values.mockClear()
    m.onConflictDoNothing.mockClear()
    m.returning.mockClear()
  })

  it('returns true on first claim (insert succeeded)', async () => {
    const m = getMocks()
    m.returning.mockResolvedValueOnce([{ jobId: 'job_1' }])
    const claimed = await claimHookDelivery('job_1', 'webhook')
    expect(claimed).toBe(true)
    expect(m.insert).toHaveBeenCalledOnce()
    expect(m.values).toHaveBeenCalledWith({ jobId: 'job_1', hookType: 'webhook' })
  })

  it('returns false on second claim (conflict, no row returned)', async () => {
    const m = getMocks()
    m.returning.mockResolvedValueOnce([])
    const claimed = await claimHookDelivery('job_1', 'webhook')
    expect(claimed).toBe(false)
  })

  it('passes through for missing jobId (test/ad-hoc paths)', async () => {
    const m = getMocks()
    const claimed = await claimHookDelivery(undefined, 'webhook')
    expect(claimed).toBe(true)
    expect(m.insert).not.toHaveBeenCalled()
  })

  it('records the hookType so retention sweeps can target one hook', async () => {
    const m = getMocks()
    m.returning.mockResolvedValueOnce([{ jobId: 'job_2' }])
    await claimHookDelivery('job_2', 'ai')
    expect(m.values).toHaveBeenCalledWith({ jobId: 'job_2', hookType: 'ai' })
  })
})
