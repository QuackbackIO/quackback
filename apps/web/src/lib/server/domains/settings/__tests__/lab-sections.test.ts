import { describe, it, expect } from 'vitest'
import {
  DEFAULT_FEATURE_FLAGS,
  LAB_SECTIONS,
  GA_FEATURE_SECTIONS,
  PRODUCT_DEFINITIONS,
  FEATURE_FLAG_REGISTRY,
  LEGACY_FLAG_MAP,
  enableFlagsForUseCase,
  featureFlagsForUseCase,
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
    const gaFlags = GA_FEATURE_SECTIONS.flatMap((s) =>
      s.flags.flatMap((row) => [row.key, ...(row.subFlags ?? [])])
    )
    const surfaced = [...productFlags, ...labFlags, ...gaFlags]
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
    expect(isProductEnabled(DEFAULT_FEATURE_FLAGS, 'feedback')).toBe(true)
    expect(isProductEnabled(DEFAULT_FEATURE_FLAGS, 'changelog')).toBe(true)
    expect(isProductEnabled(DEFAULT_FEATURE_FLAGS, 'support')).toBe(false)
    expect(isProductEnabled(DEFAULT_FEATURE_FLAGS, 'helpCenter')).toBe(false)
    expect(isProductEnabled(DEFAULT_FEATURE_FLAGS, 'status')).toBe(false)
    expect(LAB_SECTIONS.flatMap((s) => s.flags.map((row) => row.key))).not.toContain('helpCenter')
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
    for (const section of [...LAB_SECTIONS, ...GA_FEATURE_SECTIONS]) {
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
      expect(off[umbrella], `${legacyKey} (false) -> ${umbrella}`).toBe(
        DEFAULT_FEATURE_FLAGS[umbrella]
      )
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

describe('featureFlagsForUseCase', () => {
  it('keeps the core products on and extra modules off for feedback and internal', () => {
    for (const useCase of ['product_feedback', 'internal'] as const) {
      const flags = featureFlagsForUseCase(useCase)
      expect(flags).toEqual(DEFAULT_FEATURE_FLAGS)
      expect(isProductEnabled(flags, 'feedback')).toBe(true)
      expect(isProductEnabled(flags, 'changelog')).toBe(true)
      expect(isProductEnabled(flags, 'support')).toBe(false)
      expect(isProductEnabled(flags, 'helpCenter')).toBe(false)
      expect(isProductEnabled(flags, 'status')).toBe(false)
    }
  })

  it('turns Support on for a support goal without enabling Help Center or Status', () => {
    const flags = featureFlagsForUseCase('customer_support')
    expect(isProductEnabled(flags, 'support')).toBe(true)
    expect(isProductEnabled(flags, 'helpCenter')).toBe(false)
    expect(isProductEnabled(flags, 'status')).toBe(false)
    expect(flags.inboxAi).toBe(false)
  })

  it('turns Help Center on as a product, not a Labs flag, for a help-center goal', () => {
    const flags = featureFlagsForUseCase('help_center')
    expect(isProductEnabled(flags, 'helpCenter')).toBe(true)
    expect(isProductEnabled(flags, 'support')).toBe(false)
    expect(LAB_SECTIONS.flatMap((section) => section.flags.map((row) => row.key))).not.toContain(
      'helpCenter'
    )
  })

  it('enables a goal module without turning an already-on product off', () => {
    const current = featureFlagsForUseCase('help_center')
    const merged = enableFlagsForUseCase(current, 'customer_support')
    expect(isProductEnabled(merged, 'helpCenter')).toBe(true)
    expect(isProductEnabled(merged, 'support')).toBe(true)
  })
})
