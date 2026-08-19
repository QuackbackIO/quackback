import { describe, it, expect } from 'vitest'
import {
  DEFAULT_FEATURE_FLAGS,
  LAB_SECTIONS,
  PRODUCT_DEFINITIONS,
  FEATURE_FLAG_REGISTRY,
  LEGACY_FLAG_MAP,
  getFirstEnabledAdminProductPath,
  getProductFlagUpdate,
  isProductEnabled,
  resolveFeatureFlags,
} from '../settings.types'

describe('feature flag settings layout', () => {
  it('surfaces every feature flag exactly once across General and Labs', () => {
    const productFlags = PRODUCT_DEFINITIONS.flatMap((product) => [...product.featureFlags])
    const labFlags = LAB_SECTIONS.flatMap((s) =>
      s.flags.flatMap((row) => [row.key, ...(row.subFlags ?? [])])
    )
    const surfaced = [...productFlags, ...labFlags]
    // No flag appears twice...
    expect(new Set(surfaced).size).toBe(surfaced.length)
    // ...and the set of surfaced flags is exactly the full flag set, so a new
    // flag can never silently go unsurfaced in settings.
    expect([...surfaced].sort()).toEqual(Object.keys(DEFAULT_FEATURE_FLAGS).sort())
  })

  it('shows the five workspace products in the expected order', () => {
    expect(PRODUCT_DEFINITIONS.map((product) => product.label)).toEqual([
      'Feedback & Roadmaps',
      'Support',
      'Help Center',
      'Changelog',
      'Status',
    ])
    for (const product of PRODUCT_DEFINITIONS) {
      expect(isProductEnabled(DEFAULT_FEATURE_FLAGS, product.id)).toBe(true)
    }
  })

  it('updates both Support capabilities from its single product toggle', () => {
    expect(getProductFlagUpdate('support', false)).toEqual({
      supportInbox: false,
      supportTickets: false,
    })
    expect(isProductEnabled({ supportInbox: true, supportTickets: false }, 'support')).toBe(true)
    expect(isProductEnabled({ supportInbox: false, supportTickets: false }, 'support')).toBe(false)
  })

  it('keeps every product toggle independent', () => {
    for (const product of PRODUCT_DEFINITIONS) {
      const update = getProductFlagUpdate(product.id, false)
      expect(Object.keys(update).sort()).toEqual([...product.featureFlags].sort())
    }
  })

  it('routes to the first enabled product and handles an all-off workspace', () => {
    const allOff = {
      ...DEFAULT_FEATURE_FLAGS,
      feedback: false,
      supportInbox: false,
      supportTickets: false,
      helpCenter: false,
      changelog: false,
      statusPage: false,
    }
    expect(getFirstEnabledAdminProductPath({ ...allOff, changelog: true })).toBe('/admin/changelog')
    expect(getFirstEnabledAdminProductPath(allOff)).toBe('/admin/analytics')
  })

  it('only references flags that exist in the registry', () => {
    for (const section of LAB_SECTIONS) {
      for (const row of section.flags) {
        expect(FEATURE_FLAG_REGISTRY[row.key]).toBeDefined()
        for (const sub of row.subFlags ?? []) {
          expect(FEATURE_FLAG_REGISTRY[sub]).toBeDefined()
        }
      }
    }
  })
})

describe('resolveFeatureFlags', () => {
  it('returns defaults for a null row', () => {
    expect(resolveFeatureFlags(null)).toEqual(DEFAULT_FEATURE_FLAGS)
  })

  it('keeps stored values for current keys and drops unknown keys', () => {
    const flags = resolveFeatureFlags(JSON.stringify({ helpCenter: false, notAFlag: true }))
    expect(flags.helpCenter).toBe(false)
    expect(flags).not.toHaveProperty('notAFlag')
    expect(Object.keys(flags).sort()).toEqual(Object.keys(DEFAULT_FEATURE_FLAGS).sort())
  })

  it('coalesces every legacy key into its umbrella flag', () => {
    for (const [legacyKey, umbrella] of Object.entries(LEGACY_FLAG_MAP)) {
      const on = resolveFeatureFlags(JSON.stringify({ [legacyKey]: true }))
      expect(on[umbrella], `${legacyKey} -> ${umbrella}`).toBe(true)
      const off = resolveFeatureFlags(JSON.stringify({ [legacyKey]: false }))
      expect(off[umbrella], `${legacyKey} (false) -> ${umbrella}`).toBe(false)
    }
  })

  it('lets an explicit umbrella value win over legacy keys', () => {
    const flags = resolveFeatureFlags(JSON.stringify({ inboxAi: false, assistantCopilot: true }))
    expect(flags.inboxAi).toBe(false)
  })

  it('does not resurrect a disabled inbox from a stored linkPreviews value', () => {
    const flags = resolveFeatureFlags(JSON.stringify({ supportInbox: false, linkPreviews: true }))
    expect(flags.supportInbox).toBe(false)
  })
})
