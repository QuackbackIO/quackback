import { describe, it, expect, beforeEach } from 'vitest'
import { OSS_TIER_LIMITS, type TierLimits } from '../tier-limits.types'
import { mergeTierLimits, getTierLimits, invalidateTierLimitsCache } from '../tier-limits.service'

describe('OSS_TIER_LIMITS', () => {
  it('has all numeric limits set to null (unlimited)', () => {
    expect(OSS_TIER_LIMITS.maxBoards).toBeNull()
    expect(OSS_TIER_LIMITS.maxPosts).toBeNull()
    expect(OSS_TIER_LIMITS.maxTeamSeats).toBeNull()
    expect(OSS_TIER_LIMITS.aiOpsPerMonth).toBeNull()
    expect(OSS_TIER_LIMITS.apiRequestsPerMonth).toBeNull()
    expect(OSS_TIER_LIMITS.apiRequestsPerMinute).toBeNull()
  })

  it('has every feature flag set to true (on)', () => {
    const features = OSS_TIER_LIMITS.features
    expect(features.customDomain).toBe(true)
    expect(features.customOidcProvider).toBe(true)
    expect(features.ipAllowlist).toBe(true)
    expect(features.aiSummaries).toBe(true)
    expect(features.aiMergeSuggestions).toBe(true)
    expect(features.aiSentiment).toBe(true)
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

  it('returns OSS defaults when stored is empty object', () => {
    expect(mergeTierLimits({})).toEqual(OSS_TIER_LIMITS)
  })

  it('overrides numeric limits from stored partial', () => {
    const result = mergeTierLimits({ maxBoards: 2, maxPosts: 100 })
    expect(result.maxBoards).toBe(2)
    expect(result.maxPosts).toBe(100)
    expect(result.maxTeamSeats).toBeNull()
  })

  it('overrides feature flags individually without dropping the rest', () => {
    const result = mergeTierLimits({
      features: { customDomain: false, ipAllowlist: false } as Partial<TierLimits['features']>,
    })
    expect(result.features.customDomain).toBe(false)
    expect(result.features.ipAllowlist).toBe(false)
    expect(result.features.customOidcProvider).toBe(true)
    expect(result.features.aiSummaries).toBe(true)
  })

  it('treats explicit null as unlimited (not as missing)', () => {
    const result = mergeTierLimits({ maxBoards: null })
    expect(result.maxBoards).toBeNull()
  })
})

describe('getTierLimits OSS short-circuit', () => {
  beforeEach(() => {
    invalidateTierLimitsCache()
  })

  it('returns OSS_TIER_LIMITS without reading the DB when EDITION!=cloud', async () => {
    // EDITION is unset in the test env -> IS_CLOUD is false.
    // We can't easily spy on the dynamic db import; instead we assert the
    // returned shape is identical to OSS_TIER_LIMITS (the short-circuit
    // returns the constant by reference).
    const result = await getTierLimits()
    expect(result).toBe(OSS_TIER_LIMITS)
  })
})
