import { describe, it, expect } from 'vitest'
import { OSS_TIER_LIMITS, type TierLimits } from '../tier-limits.types'

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
