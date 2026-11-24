/**
 * The Plan limits page's "fixed" rows: a cap over at first detection that
 * fits now. A cap with no limit any more is not a fix to count, a cap fixed
 * during grace stays counted after the date, and a partial fix leaves the
 * rest over with the same grace.
 */
import { describe, expect, it } from 'vitest'
import { OSS_TIER_LIMITS, type TierLimits } from '@/lib/server/domains/settings/tier-limits.types'
import { DISABLED_CLOUD_CONFIG } from '@/lib/server/domains/settings/cloud/cloud.types'
import { planFeatureSet } from '../plan-limits.features'
import { computePlanLimits, type PlanLimitsInputs } from '../plan-limits.rules'

const NOW = new Date('2026-11-18T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000
const at = (ms: number) => new Date(NOW.getTime() + ms)

const FREE_LIMITS: TierLimits = {
  ...OSS_TIER_LIMITS,
  maxBoards: 1,
  maxPosts: 50,
  maxTeamSeats: 1,
  maxStatusComponents: 3,
  maxCustomRoles: 0,
  maxSendingDomains: 0,
  maxInboundEmailAddresses: 1,
  maxHelpCenterLocales: 1,
  maxStatusSubscribers: 100,
}

const FITS: Record<string, number> = {
  maxBoards: 1,
  maxPosts: 10,
  maxTeamSeats: 1,
  maxStatusComponents: 1,
  maxCustomRoles: 0,
  maxSendingDomains: 0,
  maxInboundEmailAddresses: 1,
  maxHelpCenterLocales: 1,
  maxStatusSubscribers: 5,
}
const OVER_THREE = { ...FITS, maxBoards: 5, maxTeamSeats: 3, maxStatusComponents: 4 }
const BASIS = { cloudRevision: 5, authConfigVersion: 2 }

function inputs(over: Partial<PlanLimitsInputs> = {}): PlanLimitsInputs {
  return {
    enabled: true,
    plan: 'free',
    limits: FREE_LIMITS,
    features: planFeatureSet(OSS_TIER_LIMITS.features, DISABLED_CLOUD_CONFIG),
    usage: FITS,
    configured: {},
    stored: null,
    previous: null,
    candidates: {},
    basis: BASIS,
    ...over,
  }
}

const first = () => computePlanLimits(inputs({ usage: OVER_THREE }), at(-2 * DAY)).nextState!

describe('computePlanLimits: fixed rows', () => {
  it('never lists a cap that has no limit any more as fixed', () => {
    // A reader behind the basis keeps the stored grace but reads newer limits
    // with no seat cap: seats are not "fixed", they are simply not limited.
    const view = computePlanLimits(
      inputs({
        usage: OVER_THREE,
        stored: first(),
        basis: { cloudRevision: 4, authConfigVersion: 2 },
        limits: { ...FREE_LIMITS, maxTeamSeats: null },
      }),
      NOW
    ).view
    expect(view.issues.map((issue) => issue.key)).toEqual(['maxBoards', 'maxStatusComponents'])
    expect(view.fixedIssues).toEqual([])
  })

  it('keeps a fix made during grace counted after the date, with the same deadline', () => {
    const stored = first()
    const after = computePlanLimits(
      inputs({ usage: { ...OVER_THREE, maxStatusComponents: 3 }, stored }),
      at(30 * DAY)
    )
    expect(after.view.phase).toBe('enforced')
    expect(after.view.graceEndsAt).toBe(stored.graceEndsAt)
    expect(after.view.fixedIssues).toEqual([{ key: 'maxStatusComponents', used: 3, cap: 3 }])
    expect(after.view.issues.map((issue) => issue.key)).toEqual(['maxBoards', 'maxTeamSeats'])
  })

  it('returns to ok once every cap is fixed; going back over keeps the one grace, a new drop starts afresh', () => {
    const stored = first()
    const fixed = computePlanLimits(inputs({ usage: FITS, stored }), NOW)
    expect(fixed.view.phase).toBe('ok')
    expect(fixed.view.fixedIssues ?? []).toEqual([])
    expect(fixed.view.issues).toEqual([])
    // Back over the same limits: the same grace, never a new one.
    const again = computePlanLimits(
      inputs({ usage: { ...FITS, maxBoards: 2 }, stored: fixed.nextState }),
      at(3 * DAY)
    )
    expect(again.nextState?.since).toBe(stored.since)
    expect(again.view.graceEndsAt).toBe(stored.graceEndsAt)
    // A later drop to other limits: a fresh grace, with only its own caps to fix.
    const dropped = computePlanLimits(
      inputs({
        usage: { ...FITS, maxBoards: 2 },
        stored: fixed.nextState,
        limits: { ...FREE_LIMITS, maxStatusComponents: 2 },
      }),
      at(3 * DAY)
    )
    expect(dropped.nextState?.since).toBe(at(3 * DAY).toISOString())
    expect(dropped.nextState?.overKeys).toEqual(['maxBoards'])
    expect(dropped.view.fixedIssues).toEqual([])
  })
})
