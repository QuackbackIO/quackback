import { describe, it, expect } from 'vitest'
import {
  DEFAULT_FEATURE_FLAGS,
  PRODUCT_DEFINITIONS,
  enableFlagsForUseCase,
  flagsForGoal,
  newlyEnabledProductLabels,
  featureFlagsForUseCase,
  getFirstEnabledAdminProductPath,
  getProductFlagUpdate,
  isProductEnabled,
  resolveFeatureFlags,
} from '../settings.types'

describe('feature flag settings layout', () => {
  it('places every remaining flag on exactly one product', () => {
    const productFlags = PRODUCT_DEFINITIONS.flatMap((product) => [...product.featureFlags])
    expect(new Set(productFlags).size).toBe(productFlags.length)
    expect([...productFlags].sort()).toEqual(Object.keys(DEFAULT_FEATURE_FLAGS).sort())
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
    expect(PRODUCT_DEFINITIONS.find((product) => product.id === 'status')?.description).toBe(
      'Publish a status page with live service status, incidents, maintenance, and uptime history.'
    )
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
    expect(getFirstEnabledAdminProductPath({ ...allOff, supportInbox: true })).toBe('/admin/inbox')
    expect(getFirstEnabledAdminProductPath({ ...allOff, feedback: true, supportInbox: true })).toBe(
      '/admin/feedback'
    )
    expect(getFirstEnabledAdminProductPath(allOff)).toBe('/admin/analytics')
  })
})

describe('resolveFeatureFlags', () => {
  it('returns defaults for a null row', () => {
    expect(resolveFeatureFlags(null)).toEqual(DEFAULT_FEATURE_FLAGS)
  })

  it('keeps stored values for current keys and drops unknown keys', () => {
    const flags = resolveFeatureFlags(
      JSON.stringify({ helpCenter: false, notAFlag: true, inboxAi: true })
    )
    expect(flags.helpCenter).toBe(false)
    expect(flags).not.toHaveProperty('notAFlag')
    expect(flags).not.toHaveProperty('inboxAi')
    expect(Object.keys(flags).sort()).toEqual(Object.keys(DEFAULT_FEATURE_FLAGS).sort())
  })

  it('does not resurrect a disabled inbox from a stored linkPreviews value', () => {
    const flags = resolveFeatureFlags(JSON.stringify({ supportInbox: false, linkPreviews: true }))
    expect(flags.supportInbox).toBe(false)
  })

  it('forces feedback true even when stored false', () => {
    const flags = resolveFeatureFlags(JSON.stringify({ feedback: false }))
    expect(flags.feedback).toBe(true)
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
  })

  it('turns Help Center on as a product for a help-center goal', () => {
    const flags = featureFlagsForUseCase('help_center')
    expect(isProductEnabled(flags, 'helpCenter')).toBe(true)
    expect(isProductEnabled(flags, 'support')).toBe(false)
  })

  it('enables a goal module without turning an already-on product off', () => {
    const current = featureFlagsForUseCase('help_center')
    const merged = enableFlagsForUseCase(current, 'customer_support')
    expect(isProductEnabled(merged, 'helpCenter')).toBe(true)
    expect(isProductEnabled(merged, 'support')).toBe(true)
  })

  it('names only the products that this goal change newly turned on', () => {
    expect(flagsForGoal(DEFAULT_FEATURE_FLAGS, 'help_center')).toEqual({
      flags: featureFlagsForUseCase('help_center'),
      enabledModules: ['Help Center'],
    })
    expect(flagsForGoal(DEFAULT_FEATURE_FLAGS, 'customer_support').enabledModules).toEqual([
      'Support',
    ])
    expect(
      flagsForGoal(featureFlagsForUseCase('help_center'), 'help_center').enabledModules
    ).toEqual([])
    expect(
      newlyEnabledProductLabels(DEFAULT_FEATURE_FLAGS, featureFlagsForUseCase('help_center'))
    ).toEqual(['Help Center'])
  })
})
