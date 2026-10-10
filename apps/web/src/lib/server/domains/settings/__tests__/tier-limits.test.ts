import { describe, it, expect } from 'vitest'
import { OSS_TIER_LIMITS, type TierLimits } from '../tier-limits.types'
import { mergeTierLimits, resolveEffectiveTierLimits } from '../tier-limits.service'
import {
  overlayProjectedLimits,
  parseBillingProjection,
  projectedLimitsAt,
  type BillingProjection,
  type ProjectedLimits,
} from '../cloud/billing-projection'

describe('OSS_TIER_LIMITS', () => {
  it('has all numeric limits set to null (unlimited)', () => {
    expect(OSS_TIER_LIMITS.maxBoards).toBeNull()
    expect(OSS_TIER_LIMITS.maxPosts).toBeNull()
    expect(OSS_TIER_LIMITS.maxTeamSeats).toBeNull()
    expect(OSS_TIER_LIMITS.aiTokensPerMonth).toBeNull()
    expect(OSS_TIER_LIMITS.apiRequestsPerMonth).toBeNull()
    expect(OSS_TIER_LIMITS.apiRequestsPerMinute).toBeNull()
  })

  it('has every feature flag set to true (on)', () => {
    const features = OSS_TIER_LIMITS.features
    expect(features.customDomain).toBe(true)
    expect(features.customOidcProvider).toBe(true)
    expect(features.ipAllowlist).toBe(true)
    expect(features.webhooks).toBe(true)
    expect(features.mcpServer).toBe(true)
    expect(features.analyticsExports).toBe(true)
  })

  it('matches the TierLimits shape (compile-time check)', () => {
    const _: TierLimits = OSS_TIER_LIMITS
    expect(_).toBe(OSS_TIER_LIMITS)
  })
})

describe('mergeTierLimits', () => {
  it('returns OSS defaults when stored is null', () => {
    expect(mergeTierLimits(null)).toEqual(OSS_TIER_LIMITS)
  })

  it('falls back to OSS feature defaults for a stored row with no features', () => {
    expect(mergeTierLimits({})).toEqual({
      ...OSS_TIER_LIMITS,
      features: { ...OSS_TIER_LIMITS.features },
    })
  })

  it('overrides numeric limits from stored partial', () => {
    const result = mergeTierLimits({ maxBoards: 2, maxPosts: 100 })
    expect(result.maxBoards).toBe(2)
    expect(result.maxPosts).toBe(100)
    expect(result.maxTeamSeats).toBeNull()
  })

  it('overrides feature flags individually without dropping the rest', () => {
    const result = mergeTierLimits({
      features: { customDomain: false, ipAllowlist: false },
    })
    expect(result.features.customDomain).toBe(false)
    expect(result.features.ipAllowlist).toBe(false)
    expect(result.features.customOidcProvider).toBe(true)
    expect(result.features.webhooks).toBe(true)
  })

  it('treats explicit null as unlimited (not as missing)', () => {
    const result = mergeTierLimits({ maxBoards: null })
    expect(result.maxBoards).toBeNull()
  })
})

describe('plan notice passthrough', () => {
  it('carries a stored notice through the merge', () => {
    const merged = mergeTierLimits({
      maxBoards: 5,
      notice: {
        label: 'Free trial',
        expiresAt: '2026-06-24T00:00:00.000Z',
        actionUrl: 'https://example.com/billing',
        actionLabel: 'Choose your plan',
      },
    })
    expect(merged.notice).toEqual({
      label: 'Free trial',
      expiresAt: '2026-06-24T00:00:00.000Z',
      actionUrl: 'https://example.com/billing',
      actionLabel: 'Choose your plan',
    })
    expect(merged.maxBoards).toBe(5)
  })

  it('returns no notice when absent from stored limits', () => {
    expect(mergeTierLimits({ maxBoards: 1 }).notice).toBeUndefined()
    expect(mergeTierLimits(null).notice).toBeUndefined()
  })
})

const PROJECTED_LIMITS: ProjectedLimits = {
  maxBoards: 25,
  maxPosts: 1_000,
  maxTeamSeats: 10,
  maxStatusComponents: 25,
  maxCustomRoles: 5,
  maxSendingDomains: 3,
  aiTokensPerMonth: 100_000,
  emailsPerMonth: null,
  apiRequestsPerMonth: 100_000,
  apiRequestsPerMinute: 600,
}

const PROJECTION: BillingProjection = {
  version: 1,
  effectivePlan: 'business',
  trialStartedAt: '2026-08-01T00:00:00.000Z',
  trialExpiresAt: '2026-08-15T00:00:00.000Z',
  subscriptionStatus: null,
  entitlements: { customDomain: true },
  freeLimits: { ...PROJECTED_LIMITS, maxBoards: 2 },
  planLimits: PROJECTED_LIMITS,
  planLimitsExpireAt: '2026-08-15T00:00:00.000Z',
  canUpgrade: true,
  canManageBilling: false,
  renewalAt: null,
  cancellationAt: null,
}

describe('projected numeric limits', () => {
  it('raises Free limits while preserving higher operator allowances', () => {
    const baseline = mergeTierLimits({
      maxBoards: 2,
      maxPosts: 500,
      features: { customDomain: false },
      notice: { label: 'Operator notice' },
    })

    const effective = overlayProjectedLimits(baseline, {
      ...PROJECTED_LIMITS,
      maxBoards: 25,
      maxPosts: 100,
    })

    expect(effective.maxBoards).toBe(25)
    expect(effective.maxPosts).toBe(500)
    expect(effective.features.customDomain).toBe(false)
    expect(effective.notice).toEqual({ label: 'Operator notice' })
  })

  it('preserves unlimited baselines and grants unlimited Pro fields', () => {
    const baseline = mergeTierLimits({ maxBoards: null, maxPosts: 10 })
    const effective = overlayProjectedLimits(baseline, {
      ...PROJECTED_LIMITS,
      maxBoards: 25,
      maxPosts: null,
    })

    expect(effective.maxBoards).toBeNull()
    expect(effective.maxPosts).toBeNull()
  })

  it('falls back to the cached Free baseline at the exact expiry instant', () => {
    const baseline = mergeTierLimits({ maxBoards: 2 })
    expect(
      projectedLimitsAt(PROJECTION, baseline, new Date('2026-08-14T23:59:59.999Z')).maxBoards
    ).toBe(25)
    expect(
      projectedLimitsAt(PROJECTION, baseline, new Date('2026-08-15T00:00:00.000Z')).maxBoards
    ).toBe(2)
  })

  it('rejects unknown fields, provider references, and incomplete limits', () => {
    expect(parseBillingProjection(PROJECTION)).toEqual(PROJECTION)
    expect(parseBillingProjection({ ...PROJECTION, customerRef: 'cus_secret' })).toBeNull()
    expect(
      parseBillingProjection({
        ...PROJECTION,
        planLimits: { ...PROJECTION.planLimits, maxBoards: undefined },
      })
    ).toBeNull()
  })

  it('accepts a nine-key live projection and treats missing emailsPerMonth as unlimited', () => {
    const { emailsPerMonth: _omitted, ...nineKey } = PROJECTED_LIMITS
    const parsed = parseBillingProjection({
      ...PROJECTION,
      freeLimits: { ...nineKey, maxBoards: 2 },
      planLimits: nineKey,
    })
    expect(parsed).not.toBeNull()
    expect(parsed?.planLimits.emailsPerMonth).toBeNull()
    expect(parsed?.freeLimits.emailsPerMonth).toBeNull()
    expect(parsed?.planLimits.maxBoards).toBe(25)
    expect(parsed?.canManageBilling).toBe(false)
  })

  it('rejects unrecognised plans and non-canonical dates', () => {
    expect(parseBillingProjection({ ...PROJECTION, effectivePlan: 'platinum' })).toBeNull()
    expect(parseBillingProjection({ ...PROJECTION, trialExpiresAt: 'August 15' })).toBeNull()
  })

  it('keeps pro/business/enterprise projection slugs and maps leftover growth/scale', () => {
    expect(parseBillingProjection({ ...PROJECTION, effectivePlan: 'business' })).toEqual({
      ...PROJECTION,
      effectivePlan: 'business',
    })
    expect(parseBillingProjection({ ...PROJECTION, effectivePlan: 'enterprise' })).toEqual({
      ...PROJECTION,
      effectivePlan: 'enterprise',
    })
    expect(parseBillingProjection({ ...PROJECTION, effectivePlan: 'pro' })).toEqual({
      ...PROJECTION,
      effectivePlan: 'pro',
    })
    expect(parseBillingProjection({ ...PROJECTION, effectivePlan: 'growth' })).toEqual({
      ...PROJECTION,
      effectivePlan: 'pro',
    })
    expect(parseBillingProjection({ ...PROJECTION, effectivePlan: 'scale' })).toEqual({
      ...PROJECTION,
      effectivePlan: 'enterprise',
    })
  })

  it('ignores unknown entitlement keys so a newer control plane cannot drop the projection', () => {
    expect(
      parseBillingProjection({
        ...PROJECTION,
        entitlements: { ...PROJECTION.entitlements, secretFeature: true },
      })
    ).toEqual(PROJECTION)
  })
})

describe('resolveEffectiveTierLimits (cloud, no operator row)', () => {
  const beforeExpiry = new Date('2026-08-14T12:00:00.000Z')
  const atExpiry = new Date('2026-08-15T00:00:00.000Z')

  it('self-host with no row stays unlimited', () => {
    expect(resolveEffectiveTierLimits(null, null)).toEqual(OSS_TIER_LIMITS)
  })

  it('does not inherit OSS unlimited once a billing projection is present', () => {
    const effective = resolveEffectiveTierLimits(null, PROJECTION, beforeExpiry)
    expect(effective.maxBoards).toBe(25)
    expect(effective.maxPosts).toBe(PROJECTED_LIMITS.maxPosts)
    expect(effective.features.customDomain).toBe(true)
    expect(effective.features.webhooks).toBe(false)
    expect(effective.features.ipAllowlist).toBe(false)
  })

  it('copies Pro-only feature flags from the projected plan, not only entitlements', () => {
    const effective = resolveEffectiveTierLimits(null, PROJECTION, beforeExpiry)
    expect(effective.features.analyticsExports).toBe(true)
    expect(effective.features.customColors).toBe(true)
    expect(effective.features.customCss).toBe(true)
    expect(effective.features.integrations).toBe(true)
  })

  it('maps leftover growth/scale onto pro/enterprise PLAN_ONLY_FEATURES', () => {
    const pro = parseBillingProjection({ ...PROJECTION, effectivePlan: 'pro' })
    const growth = parseBillingProjection({ ...PROJECTION, effectivePlan: 'growth' })
    const scale = parseBillingProjection({ ...PROJECTION, effectivePlan: 'scale' })
    const enterprise = parseBillingProjection({ ...PROJECTION, effectivePlan: 'enterprise' })
    expect(pro).not.toBeNull()
    expect(growth).not.toBeNull()
    expect(scale).not.toBeNull()
    expect(enterprise).not.toBeNull()
    const fromPro = resolveEffectiveTierLimits(null, pro, beforeExpiry)
    const fromGrowth = resolveEffectiveTierLimits(null, growth, beforeExpiry)
    const fromScale = resolveEffectiveTierLimits(null, scale, beforeExpiry)
    const fromEnterprise = resolveEffectiveTierLimits(null, enterprise, beforeExpiry)
    expect(fromPro.features).toEqual(fromGrowth.features)
    expect(fromScale.features).toEqual(fromEnterprise.features)
    expect(fromPro.features.integrations).toBe(false)
    expect(fromEnterprise.features.integrations).toBe(true)
  })

  it('keeps Growth feature flags closed for keys that are not entitlements', () => {
    const growth: BillingProjection = { ...PROJECTION, effectivePlan: 'pro' }
    const effective = resolveEffectiveTierLimits(null, growth, beforeExpiry)
    expect(effective.features.analyticsExports).toBe(false)
    expect(effective.features.integrations).toBe(false)
    expect(effective.features.customColors).toBe(true)
    expect(effective.features.customCss).toBe(false)
  })

  it('allows custom colours on Free', () => {
    const free: BillingProjection = { ...PROJECTION, effectivePlan: 'free' }
    const effective = resolveEffectiveTierLimits(null, free, beforeExpiry)
    expect(effective.features.customColors).toBe(true)
    expect(effective.features.customCss).toBe(false)
  })

  it('falls back to projected Free numbers and closed features at exact expiry', () => {
    const effective = resolveEffectiveTierLimits(null, PROJECTION, atExpiry)
    expect(effective.maxBoards).toBe(2)
    expect(effective.features.customDomain).toBe(false)
    expect(effective.features.webhooks).toBe(false)
    expect(effective.features.analyticsExports).toBe(false)
    expect(effective.features.integrations).toBe(false)
    expect(effective.features.customColors).toBe(true)
  })

  it('still raises a stored operator floor in the least-restrictive direction', () => {
    const effective = resolveEffectiveTierLimits(
      { maxBoards: 2, maxPosts: 500, features: { customDomain: false } },
      PROJECTION,
      beforeExpiry
    )
    expect(effective.maxBoards).toBe(25)
    expect(effective.maxPosts).toBe(PROJECTED_LIMITS.maxPosts)
    expect(effective.features.customDomain).toBe(false)
  })
})
