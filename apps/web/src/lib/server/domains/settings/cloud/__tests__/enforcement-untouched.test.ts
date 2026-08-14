import { describe, expect, it } from 'vitest'
import { OSS_TIER_LIMITS, type TierFeatureFlags } from '../../tier-limits.types'
import { mergeTierLimits } from '../../tier-limits.service'
import { ENTITLEMENTS, ENTITLEMENT_KEYS } from '../cloud.types'

describe('the numeric default path is unchanged', () => {
  it('an install with no tier-limits row still gets the identical OSS object', () => {
    // Reference equality, not deep equality: `mergeTierLimits(null)` returning
    // the shared constant is the short-circuit that makes an unconfigured
    // install cost nothing. A wrapper that spread it into a new object would
    // still pass a toEqual check.
    expect(mergeTierLimits(null)).toBe(OSS_TIER_LIMITS)
  })

  it('every numeric limit is still unlimited and every tier feature still on', () => {
    const { features, notice, ...numeric } = OSS_TIER_LIMITS
    for (const value of Object.values(numeric)) expect(value).toBeNull()
    for (const value of Object.values(features)) expect(value).toBe(true)
    expect(notice).toBeUndefined()
  })
})

describe('the catalogue stays honest about its overlap with tier features', () => {
  it('every declared tierFeature is a real TierFeatureFlags key', () => {
    const tierFeatureKeys = Object.keys(OSS_TIER_LIMITS.features) as Array<keyof TierFeatureFlags>
    for (const key of ENTITLEMENT_KEYS) {
      const mapped = ENTITLEMENTS[key].tierFeature
      if (mapped === null) continue
      expect(tierFeatureKeys).toContain(mapped)
    }
  })

  it('no two entitlements claim the same tier feature', () => {
    const claimed: Array<keyof TierFeatureFlags> = []
    for (const key of ENTITLEMENT_KEYS) {
      const mapped = ENTITLEMENTS[key].tierFeature
      if (mapped !== null) claimed.push(mapped)
    }
    expect(new Set(claimed).size).toBe(claimed.length)
  })

  it('every entitlement documents where its gate sits', () => {
    for (const key of ENTITLEMENT_KEYS) {
      expect(ENTITLEMENTS[key].chokepoint.length).toBeGreaterThan(0)
      expect(ENTITLEMENTS[key].friendly.length).toBeGreaterThan(0)
    }
  })
})
