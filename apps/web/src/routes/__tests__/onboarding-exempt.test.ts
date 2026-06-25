import { describe, it, expect } from 'vitest'
import { isOnboardingExempt } from '../__root'

describe('onboarding exempt paths', () => {
  it('exempts the unified login and admin redirect stub', () => {
    expect(isOnboardingExempt('/auth/login')).toBe(true)
    expect(isOnboardingExempt('/admin/login')).toBe(true) // still redirects, must not loop into onboarding
  })
})
