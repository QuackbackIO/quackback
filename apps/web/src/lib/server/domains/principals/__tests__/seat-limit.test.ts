import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'

const hoisted = vi.hoisted(() => ({
  countSeatUsage: vi.fn(),
}))

vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: vi.fn(),
}))

vi.mock('../seat-usage', () => ({
  countSeatUsage: () => hoisted.countSeatUsage(),
}))

import { enforceSeatLimit } from '../seat-limit'
import { getTierLimits } from '@/lib/server/domains/settings/tier-limits.service'
import { OSS_TIER_LIMITS } from '@/lib/server/domains/settings/tier-limits.types'
import type { SeatExecutor } from '../seat-usage'

function lockingExecutor(forUpdate: () => Promise<unknown>): SeatExecutor {
  return {
    select: () => ({
      from: () => ({
        limit: () => ({
          for: forUpdate,
        }),
      }),
    }),
  } as unknown as SeatExecutor
}

describe('enforceSeatLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.countSeatUsage.mockResolvedValue({ members: 0, pendingInvites: 0, used: 0 })
  })

  it('does nothing when maxTeamSeats is null (OSS default)', async () => {
    vi.mocked(getTierLimits).mockResolvedValue(OSS_TIER_LIMITS)
    await expect(enforceSeatLimit()).resolves.toBeUndefined()
    expect(hoisted.countSeatUsage).not.toHaveBeenCalled()
  })

  it('allows when used is under the cap', async () => {
    vi.mocked(getTierLimits).mockResolvedValue({ ...OSS_TIER_LIMITS, maxTeamSeats: 10 })
    hoisted.countSeatUsage.mockResolvedValue({ members: 4, pendingInvites: 1, used: 5 })
    await expect(enforceSeatLimit()).resolves.toBeUndefined()
  })

  it('throws TierLimitError at exact cap, counting pending invites', async () => {
    vi.mocked(getTierLimits).mockResolvedValue({ ...OSS_TIER_LIMITS, maxTeamSeats: 2 })
    hoisted.countSeatUsage.mockResolvedValue({ members: 1, pendingInvites: 1, used: 2 })
    await expect(enforceSeatLimit()).rejects.toBeInstanceOf(TierLimitError)
  })

  it('uses upgrade copy at the cap', async () => {
    vi.mocked(getTierLimits).mockResolvedValue({ ...OSS_TIER_LIMITS, maxTeamSeats: 5 })
    hoisted.countSeatUsage.mockResolvedValue({ members: 5, pendingInvites: 0, used: 5 })
    await expect(enforceSeatLimit()).rejects.toThrow(
      "You've reached your plan's team seats limit (5). Upgrade to add more."
    )
  })

  it('at accept time ignores pending invites so a reserved seat can convert', async () => {
    vi.mocked(getTierLimits).mockResolvedValue({ ...OSS_TIER_LIMITS, maxTeamSeats: 2 })
    hoisted.countSeatUsage.mockResolvedValue({ members: 1, pendingInvites: 1, used: 2 })
    await expect(enforceSeatLimit({ convertingInvite: true })).resolves.toBeUndefined()
  })

  it('at accept time refuses when members already fill the cap', async () => {
    vi.mocked(getTierLimits).mockResolvedValue({ ...OSS_TIER_LIMITS, maxTeamSeats: 2 })
    hoisted.countSeatUsage.mockResolvedValue({ members: 2, pendingInvites: 1, used: 3 })
    await expect(enforceSeatLimit({ convertingInvite: true })).rejects.toBeInstanceOf(
      TierLimitError
    )
  })

  it('takes the settings-row lock when an executor is passed', async () => {
    vi.mocked(getTierLimits).mockResolvedValue({ ...OSS_TIER_LIMITS, maxTeamSeats: 10 })
    hoisted.countSeatUsage.mockResolvedValue({ members: 4, pendingInvites: 1, used: 5 })
    const forUpdate = vi.fn(async () => [{ id: 'set_1' }])
    await expect(
      enforceSeatLimit({ executor: lockingExecutor(forUpdate) })
    ).resolves.toBeUndefined()
    expect(forUpdate).toHaveBeenCalledOnce()
  })
})
