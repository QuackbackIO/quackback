import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'

const hoisted = vi.hoisted(() => ({
  mockedSelect: vi.fn(),
}))

vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: vi.fn(),
}))

vi.mock('@/lib/server/db', async () => {
  const drizzle = await vi.importActual<typeof import('drizzle-orm')>('drizzle-orm')
  return {
    db: { select: hoisted.mockedSelect },
    principal: { id: 'pid', role: 'role', type: 'type' },
    eq: drizzle.eq,
    ne: drizzle.ne,
    inArray: drizzle.inArray,
    sql: drizzle.sql,
  }
})

import { enforceSeatLimit } from '../seat-limit'
import { getTierLimits } from '@/lib/server/domains/settings/tier-limits.service'
import { OSS_TIER_LIMITS } from '@/lib/server/domains/settings/tier-limits.types'

describe('enforceSeatLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does nothing when maxTeamSeats is null (OSS default)', async () => {
    vi.mocked(getTierLimits).mockResolvedValue(OSS_TIER_LIMITS)
    await expect(enforceSeatLimit()).resolves.toBeUndefined()
    // Count query should NOT have been called.
    expect(hoisted.mockedSelect).not.toHaveBeenCalled()
  })

  it('counts only admin + member principals (not user role) and allows when under cap', async () => {
    vi.mocked(getTierLimits).mockResolvedValue({ ...OSS_TIER_LIMITS, maxTeamSeats: 10 })
    hoisted.mockedSelect.mockReturnValue({
      from: () => ({ where: () => Promise.resolve([{ count: 5 }]) }),
    })
    await expect(enforceSeatLimit()).resolves.toBeUndefined()
  })

  it('throws TierLimitError at exact cap', async () => {
    vi.mocked(getTierLimits).mockResolvedValue({ ...OSS_TIER_LIMITS, maxTeamSeats: 2 })
    hoisted.mockedSelect.mockReturnValue({
      from: () => ({ where: () => Promise.resolve([{ count: 2 }]) }),
    })
    await expect(enforceSeatLimit()).rejects.toBeInstanceOf(TierLimitError)
  })
})
