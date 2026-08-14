import { describe, it, expect } from 'vitest'
import { OSS_TIER_LIMITS, type TierLimits } from '../tier-limits.types'
import {
  mergeTierLimits,
  overlayTrialLimits,
  resolveEffectiveTierLimits,
} from '../tier-limits.service'
import { resolveCloudConfig } from '../cloud/cloud.service'

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

describe('Pro trial numeric limits', () => {
  it('raises Free limits while preserving higher operator allowances', () => {
    const baseline = mergeTierLimits({
      maxBoards: 2,
      maxPosts: 500,
      features: { customDomain: false },
      notice: { label: 'Operator notice' },
    })

    const effective = overlayTrialLimits(baseline, { maxBoards: 25, maxPosts: 100 })

    expect(effective.maxBoards).toBe(25)
    expect(effective.maxPosts).toBe(500)
    expect(effective.features.customDomain).toBe(false)
    expect(effective.notice).toEqual({ label: 'Operator notice' })
  })

  it('preserves unlimited baselines and grants unlimited Pro fields', () => {
    const baseline = mergeTierLimits({ maxBoards: null, maxPosts: 10 })
    const effective = overlayTrialLimits(baseline, { maxBoards: 25 })

    expect(effective.maxBoards).toBeNull()
    expect(effective.maxPosts).toBeNull()
  })

  it('falls back to the cached Free baseline at the exact expiry instant', () => {
    const baseline = mergeTierLimits({ maxBoards: 2 })
    const stored = {
      enabled: true,
      plan: 'free',
      trial: {
        plan: 'pro',
        startedAt: '2026-08-01T00:00:00.000Z',
        endsAt: '2026-08-15T00:00:00.000Z',
      },
    }
    const beforeExpiry = resolveCloudConfig(stored, new Date('2026-08-14T23:59:59.999Z'))
    const atExpiry = resolveCloudConfig(stored, new Date('2026-08-15T00:00:00.000Z'))

    expect(resolveEffectiveTierLimits(baseline, beforeExpiry, { maxBoards: 25 }).maxBoards).toBe(25)
    expect(resolveEffectiveTierLimits(baseline, atExpiry, { maxBoards: 25 })).toBe(baseline)
  })

  it('rejects an active Pro trial when its catalogue limits are missing', () => {
    expect(() =>
      resolveEffectiveTierLimits(
        mergeTierLimits({ maxBoards: 2 }),
        { enabled: true, trialActive: true },
        undefined
      )
    ).toThrow('BILLING_PRICES.pro.limits')
  })
})
