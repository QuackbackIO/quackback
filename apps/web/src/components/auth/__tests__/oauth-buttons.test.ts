import { describe, it, expect } from 'vitest'
import { hasAnyPortalAuthMethod } from '../oauth-buttons'

describe('hasAnyPortalAuthMethod', () => {
  it('returns false when every method is disabled', () => {
    expect(
      hasAnyPortalAuthMethod({
        password: false,
        magicLink: false,
        google: false,
        github: false,
      })
    ).toBe(false)
  })

  it('returns false for an empty config', () => {
    expect(hasAnyPortalAuthMethod({})).toBe(false)
  })

  it('returns true when password is enabled', () => {
    expect(hasAnyPortalAuthMethod({ password: true, magicLink: false })).toBe(true)
  })

  it('returns true when magicLink is enabled', () => {
    expect(hasAnyPortalAuthMethod({ password: false, magicLink: true })).toBe(true)
  })

  it('returns true when at least one OAuth provider is enabled', () => {
    expect(
      hasAnyPortalAuthMethod({
        password: false,
        magicLink: false,
        google: true,
      })
    ).toBe(true)
  })

  it('ignores legacy email key (retired in migration 0049)', () => {
    expect(hasAnyPortalAuthMethod({ password: false, magicLink: false, email: true })).toBe(false)
  })

  it('ignores unknown provider keys that are not in the registry', () => {
    expect(hasAnyPortalAuthMethod({ password: false, magicLink: false, mystery: true })).toBe(false)
  })

  it('returns true when SSO is registered and a verified domain exists', () => {
    expect(
      hasAnyPortalAuthMethod(
        { password: false, magicLink: false },
        { ssoEnabled: true, hasVerifiedDomain: true }
      )
    ).toBe(true)
  })

  it('returns false when SSO is registered but no verified domain is set', () => {
    expect(
      hasAnyPortalAuthMethod(
        { password: false, magicLink: false },
        { ssoEnabled: true, hasVerifiedDomain: false }
      )
    ).toBe(false)
  })

  it('returns false when a verified domain exists but SSO is not registered', () => {
    expect(
      hasAnyPortalAuthMethod(
        { password: false, magicLink: false },
        { ssoEnabled: false, hasVerifiedDomain: true }
      )
    ).toBe(false)
  })
})
