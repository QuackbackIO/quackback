import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TierLimitError } from '@/lib/server/errors/tier-limit-error'

const hoisted = vi.hoisted(() => ({
  countSeatUsage: vi.fn(),
  getCloudConfig: vi.fn(),
  catalogueBilledPer: vi.fn(),
}))

vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: vi.fn(),
}))

vi.mock('../seat-usage', () => ({
  countSeatUsage: () => hoisted.countSeatUsage(),
}))

vi.mock('@/lib/server/domains/settings/cloud/cloud.service', () => ({
  getCloudConfig: () => hoisted.getCloudConfig(),
}))

vi.mock('@/lib/server/domains/billing/projection-overview', () => ({
  catalogueBilledPer: (...args: unknown[]) => hoisted.catalogueBilledPer(...args),
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
    hoisted.getCloudConfig.mockResolvedValue({
      enabled: false,
      plan: null,
      trialActive: false,
    })
    hoisted.catalogueBilledPer.mockResolvedValue(undefined)
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

  it('uses seat-specific copy on a grandfathered per-seat plan', async () => {
    vi.mocked(getTierLimits).mockResolvedValue({ ...OSS_TIER_LIMITS, maxTeamSeats: 10 })
    hoisted.countSeatUsage.mockResolvedValue({ members: 8, pendingInvites: 2, used: 10 })
    hoisted.getCloudConfig.mockResolvedValue({
      enabled: true,
      plan: 'pro',
      trialActive: false,
    })
    hoisted.catalogueBilledPer.mockResolvedValue('seat')
    await expect(enforceSeatLimit()).rejects.toThrow(
      'All 10 seats are in use. Add a seat to invite more.'
    )
  })

  it('uses upgrade copy when the catalogue plan is billed per workspace', async () => {
    vi.mocked(getTierLimits).mockResolvedValue({ ...OSS_TIER_LIMITS, maxTeamSeats: 5 })
    hoisted.countSeatUsage.mockResolvedValue({ members: 5, pendingInvites: 0, used: 5 })
    hoisted.getCloudConfig.mockResolvedValue({
      enabled: true,
      plan: 'growth',
      trialActive: false,
    })
    hoisted.catalogueBilledPer.mockResolvedValue('workspace')
    await expect(enforceSeatLimit()).rejects.toThrow(
      "You've reached your plan's team seats limit (5). Upgrade to add more."
    )
  })

  it('keeps the upgrade sentence on Free', async () => {
    vi.mocked(getTierLimits).mockResolvedValue({ ...OSS_TIER_LIMITS, maxTeamSeats: 1 })
    hoisted.countSeatUsage.mockResolvedValue({ members: 1, pendingInvites: 0, used: 1 })
    hoisted.getCloudConfig.mockResolvedValue({
      enabled: true,
      plan: 'free',
      trialActive: false,
    })
    await expect(enforceSeatLimit()).rejects.toThrow(
      "You've reached your plan's team seats limit (1). Upgrade to add more."
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

  it('resolves catalogue billedPer before taking the settings-row lock', async () => {
    const order: string[] = []
    let releaseCatalogue: () => void = () => {}
    const catalogueGate = new Promise<void>((resolve) => {
      releaseCatalogue = resolve
    })
    hoisted.catalogueBilledPer.mockImplementation(async () => {
      order.push('catalogue')
      await catalogueGate
      return 'seat'
    })
    hoisted.getCloudConfig.mockResolvedValue({
      enabled: true,
      plan: 'pro',
      trialActive: false,
    })
    hoisted.countSeatUsage.mockResolvedValue({ members: 10, pendingInvites: 0, used: 10 })
    vi.mocked(getTierLimits).mockResolvedValue({ ...OSS_TIER_LIMITS, maxTeamSeats: 10 })

    const forUpdate = vi.fn(async () => {
      order.push('lock')
      return [{ id: 'set_1' }]
    })

    const pending = enforceSeatLimit({ executor: lockingExecutor(forUpdate) })
    await vi.waitFor(() => expect(hoisted.catalogueBilledPer).toHaveBeenCalledOnce())
    expect(forUpdate).not.toHaveBeenCalled()
    releaseCatalogue()
    await expect(pending).rejects.toThrow('All 10 seats are in use. Add a seat to invite more.')
    expect(order).toEqual(['catalogue', 'lock'])
  })

  it('does not fetch the catalogue when the locked path is under the cap', async () => {
    vi.mocked(getTierLimits).mockResolvedValue({ ...OSS_TIER_LIMITS, maxTeamSeats: 10 })
    hoisted.countSeatUsage.mockResolvedValue({ members: 4, pendingInvites: 1, used: 5 })
    const forUpdate = vi.fn(async () => [{ id: 'set_1' }])
    await expect(
      enforceSeatLimit({ executor: lockingExecutor(forUpdate) })
    ).resolves.toBeUndefined()
    expect(hoisted.catalogueBilledPer).not.toHaveBeenCalled()
    expect(forUpdate).toHaveBeenCalledOnce()
  })
})
