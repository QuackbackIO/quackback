/**
 * After a projection's access window ends, the workspace is on Free. The
 * commercial config (`resolveCloudConfig`) and the tier features
 * (`resolveEffectiveTierLimits`) both read that lapse, and they must agree on
 * every Free grant: a grant entitled in one and off in the other would raise a
 * false plan limits issue and grace.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { BillingProjection } from '../billing-projection'
import { ENTITLEMENT_KEYS, PLAN_CATALOGUE, type EntitlementKey } from '../cloud.types'
import { resolveCloudConfig } from '../cloud.service'
import { ENTITLEMENT_TIER_FEATURES, resolveEffectiveTierLimits } from '../../tier-limits.service'
import { OSS_TIER_LIMITS } from '../../tier-limits.types'

const LIMITS = {
  maxBoards: 25,
  maxPosts: null,
  maxTeamSeats: 10,
  maxStatusComponents: 10,
  maxCustomRoles: 5,
  maxSendingDomains: 1,
  aiTokensPerMonth: null,
  emailsPerMonth: null,
  maxInboundEmailAddresses: null,
  maxHelpCenterLocales: null,
  maxStatusSubscribers: null,
  apiRequestsPerMonth: null,
  apiRequestsPerMinute: null,
}

/** Every entitlement on, so a lapse that kept the plan's own grants would show. */
const PROJECTION: BillingProjection = {
  version: 7,
  effectivePlan: 'enterprise',
  trialStartedAt: null,
  trialExpiresAt: null,
  subscriptionStatus: 'active',
  entitlements: Object.fromEntries(ENTITLEMENT_KEYS.map((key) => [key, true])),
  freeLimits: { ...LIMITS, maxBoards: 2 },
  planLimits: LIMITS,
  planLimitsExpireAt: '2026-08-15T00:00:00.000Z',
  canUpgrade: true,
  canManageBilling: true,
  renewalAt: null,
  cancellationAt: null,
}
const BEFORE = new Date('2026-08-14T00:00:00.000Z')
const AFTER = new Date('2026-08-15T00:00:00.000Z')

const FREE_GRANTS = PLAN_CATALOGUE.free.grants
afterEach(() => {
  PLAN_CATALOGUE.free.grants = FREE_GRANTS
})

/** Both lapse paths' reading of `entitlement`, and of its tier feature when it has one. */
function readings(entitlement: EntitlementKey, at: Date) {
  const cloud = resolveCloudConfig({ enabled: true, projection: PROJECTION }, at)
  const features = resolveEffectiveTierLimits(null, PROJECTION, at).features
  const feature = ENTITLEMENT_TIER_FEATURES[entitlement as keyof typeof ENTITLEMENT_TIER_FEATURES]
  return {
    entitled: cloud.entitlements[entitlement] === true,
    feature: feature === undefined ? undefined : features[feature],
  }
}

describe('the Free plan after a lapse', () => {
  it('pins the Free grants, which mirror the plan grants that issue billing projections', () => {
    // A change here must match a change to the Free plan's grants where
    // projections are issued, and the other way round.
    expect([...FREE_GRANTS].sort()).toEqual(['aiDrafts', 'apiAccess'])
    for (const grant of FREE_GRANTS) expect(ENTITLEMENT_KEYS).toContain(grant)
  })

  it('maps tier features from real entitlements onto real tier features', () => {
    const features = Object.keys(OSS_TIER_LIMITS.features)
    for (const [entitlement, feature] of Object.entries(ENTITLEMENT_TIER_FEATURES)) {
      expect(ENTITLEMENT_KEYS).toContain(entitlement)
      expect(features).toContain(feature)
    }
  })

  it('reads every Free grant as entitled on both paths, and every other entitlement as off', () => {
    for (const entitlement of ENTITLEMENT_KEYS) {
      const free = FREE_GRANTS.includes(entitlement)
      const after = readings(entitlement, AFTER)
      expect(after.entitled, entitlement).toBe(free)
      if (after.feature !== undefined) expect(after.feature, entitlement).toBe(free)
    }
  })

  it('agrees on both paths for any tier feature the Free plan grants', () => {
    for (const entitlement of Object.keys(ENTITLEMENT_TIER_FEATURES) as EntitlementKey[]) {
      PLAN_CATALOGUE.free.grants = [...FREE_GRANTS, entitlement]
      expect(readings(entitlement, AFTER), entitlement).toEqual({ entitled: true, feature: true })
      PLAN_CATALOGUE.free.grants = FREE_GRANTS.filter((grant) => grant !== entitlement)
      expect(readings(entitlement, AFTER), entitlement).toEqual({ entitled: false, feature: false })
    }
  })

  it('reads the projection itself before the window ends', () => {
    for (const entitlement of Object.keys(ENTITLEMENT_TIER_FEATURES) as EntitlementKey[]) {
      expect(readings(entitlement, BEFORE), entitlement).toEqual({ entitled: true, feature: true })
    }
  })
})
