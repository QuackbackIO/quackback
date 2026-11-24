import { describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({ cacheDel: vi.fn(async (..._keys: string[]) => {}) }))

vi.mock('@/lib/server/cache', () => ({
  CACHE_KEYS: { PLAN_LIMITS_INPUTS: 'plan-limits:inputs' },
  cacheDel: (...keys: string[]) => hoisted.cacheDel(...keys),
}))

import { runInAfterCommitFrame } from '@/lib/server/workspaces/after-commit'
import { invalidatePlanLimits } from '../plan-limits.cache'

describe('invalidatePlanLimits', () => {
  it('drops the inputs at once outside a transaction', async () => {
    hoisted.cacheDel.mockClear()
    await invalidatePlanLimits()
    expect(hoisted.cacheDel).toHaveBeenCalledWith('plan-limits:inputs')
  })

  it('waits for the commit inside a transaction, so a read cannot cache the old count again', async () => {
    hoisted.cacheDel.mockClear()
    await runInAfterCommitFrame(async () => {
      await invalidatePlanLimits()
      expect(hoisted.cacheDel).not.toHaveBeenCalled()
    })
    expect(hoisted.cacheDel).toHaveBeenCalledWith('plan-limits:inputs')
  })

  it('never drops it for a transaction that rolls back', async () => {
    hoisted.cacheDel.mockClear()
    await runInAfterCommitFrame(async () => {
      await invalidatePlanLimits()
      throw new Error('rollback')
    }).catch(() => undefined)
    expect(hoisted.cacheDel).not.toHaveBeenCalled()
  })
})
