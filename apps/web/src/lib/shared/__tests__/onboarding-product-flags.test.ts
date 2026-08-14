import { describe, expect, it } from 'vitest'
import { DEFAULT_FEATURE_FLAGS } from '@/lib/server/domains/settings/settings.types'
import {
  featureFlagsForNewWorkspace,
  mergeOnboardingProductFlags,
} from '../onboarding-product-flags'

describe('featureFlagsForNewWorkspace', () => {
  it('turns Inbox AI and assistant tools on without changing the shared default', () => {
    const flags = featureFlagsForNewWorkspace('customer_support')
    expect(flags.inboxAi).toBe(true)
    expect(flags.assistantTools).toBe(true)
    expect(DEFAULT_FEATURE_FLAGS.inboxAi).toBe(false)
    expect(DEFAULT_FEATURE_FLAGS.assistantTools).toBe(false)
  })
})

describe('mergeOnboardingProductFlags', () => {
  it('keeps stored AI flags when the operator changes the goal', () => {
    const flags = mergeOnboardingProductFlags(
      JSON.stringify({ ...DEFAULT_FEATURE_FLAGS, inboxAi: false, assistantTools: false }),
      'product_feedback'
    )
    expect(flags.inboxAi).toBe(false)
    expect(flags.assistantTools).toBe(false)
    expect(flags.feedback).toBe(true)
  })
})
