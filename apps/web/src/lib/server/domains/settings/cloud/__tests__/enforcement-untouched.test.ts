/**
 * Numeric enforcement must not move.
 *
 * The bar is that `getTierLimits()` and the helpers in `tier-enforce.ts` behave
 * identically and that no numeric limit changes meaning. Their own tests
 * (`../../__tests__/tier-limits.test.ts`, `../../__tests__/tier-enforce.test.ts`)
 * pass untouched, which is the primary evidence. This file adds the standing
 * invariant those tests cannot express: that the entitlement layer is a
 * *sibling* of numeric enforcement and never becomes a dependency of it.
 *
 * The direction matters. Entitlements may read tier limits; tier limits must
 * never read entitlements — otherwise a cloud-only concept ends up on the hot
 * path of every self-hosted count check, and the "default off is byte-for-byte
 * today" claim quietly stops being true.
 *
 * Modelled on the source-scanning invariant tests already in
 * `lib/server/policy/` (dep-graph, authz-matrix).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { OSS_TIER_LIMITS, type TierFeatureFlags } from '../../tier-limits.types'
import { mergeTierLimits } from '../../tier-limits.service'
import { ENTITLEMENTS, ENTITLEMENT_KEYS } from '../cloud.types'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SETTINGS_DIR = path.resolve(HERE, '../..')

/** Files that constitute numeric enforcement. Their content is the contract. */
const ENFORCEMENT_MODULES = [
  'tier-limits.types.ts',
  'tier-limits.service.ts',
  'tier-enforce.ts',
] as const

function source(file: string): string {
  return readFileSync(path.join(SETTINGS_DIR, file), 'utf8')
}

describe('the entitlement layer is a sibling of numeric enforcement, never a dependency', () => {
  it.each(ENFORCEMENT_MODULES)('%s imports nothing from cloud/', (file) => {
    const text = source(file)
    const imports = [...text.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1])
    for (const specifier of imports) {
      expect(specifier).not.toMatch(/cloud/)
    }
    expect(text).not.toMatch(/requireEntitlement|getCloudConfig|isEntitled/)
  })

  it.each(ENFORCEMENT_MODULES)('%s never mentions a plan', (file) => {
    // `getTierLimits()` returning numbers with no notion of which plan produced
    // them is the pre-existing design; this layer adds the plan beside it
    // rather than threading it through. If a plan id appears in an enforcement
    // module, the two layers have started to merge.
    expect(source(file)).not.toMatch(/\bPlanId\b|PLAN_CATALOGUE|minimumPlanFor/)
  })
})

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
