import { describe, it, expect } from 'vitest'
import {
  isOnlyWorkingSignInMethod,
  hasAnyWorkingSignInMethod,
  type SignInMethodSnapshot,
} from '../sign-in-method-availability'

// The lockout scenario: one enabled+configured IdP, password + magic link off,
// no social. The IdP is the workspace's last sign-in method.
const base: SignInMethodSnapshot = {
  targetIdpId: 'idp_1',
  tierEnabled: true,
  providers: [{ id: 'idp_1', enabled: true, configured: true }],
  oauth: { password: false, magicLink: false },
  emailConfigured: true,
  socialIds: ['google', 'github'],
  configuredSocialIds: new Set<string>(),
}

describe('isOnlyWorkingSignInMethod', () => {
  it('true when the target IdP is the sole working method', () => {
    expect(isOnlyWorkingSignInMethod(base)).toBe(true)
  })

  it('false when the target IdP is disabled (not a working method)', () => {
    expect(
      isOnlyWorkingSignInMethod({
        ...base,
        providers: [{ id: 'idp_1', enabled: false, configured: true }],
      })
    ).toBe(false)
  })

  it('false when the target IdP has no saved secret', () => {
    expect(
      isOnlyWorkingSignInMethod({
        ...base,
        providers: [{ id: 'idp_1', enabled: true, configured: false }],
      })
    ).toBe(false)
  })

  it('false when the customOidcProvider tier is off (IdP registers nothing at runtime)', () => {
    expect(isOnlyWorkingSignInMethod({ ...base, tierEnabled: false })).toBe(false)
  })

  it('false when another enabled + configured IdP exists', () => {
    expect(
      isOnlyWorkingSignInMethod({
        ...base,
        providers: [...base.providers, { id: 'idp_2', enabled: true, configured: true }],
      })
    ).toBe(false)
  })

  it('false when password is still on (absent key defaults to enabled)', () => {
    expect(isOnlyWorkingSignInMethod({ ...base, oauth: { magicLink: false } })).toBe(false)
  })

  it('false when magic link is enabled and email delivery is configured', () => {
    expect(
      isOnlyWorkingSignInMethod({
        ...base,
        oauth: { password: false, magicLink: true },
        emailConfigured: true,
      })
    ).toBe(false)
  })

  it('true when magic link is enabled but email delivery is not wired', () => {
    expect(
      isOnlyWorkingSignInMethod({
        ...base,
        oauth: { password: false, magicLink: true },
        emailConfigured: false,
      })
    ).toBe(true)
  })

  it('false when a social provider is enabled and has credentials', () => {
    expect(
      isOnlyWorkingSignInMethod({
        ...base,
        oauth: { password: false, magicLink: false, google: true },
        configuredSocialIds: new Set(['google']),
      })
    ).toBe(false)
  })

  it('true when a social provider is enabled but has no credentials', () => {
    expect(
      isOnlyWorkingSignInMethod({
        ...base,
        oauth: { password: false, magicLink: false, google: true },
        configuredSocialIds: new Set<string>(),
      })
    ).toBe(true)
  })
})

describe('hasAnyWorkingSignInMethod', () => {
  // No working method at all: tier off so the IdP doesn't register, email off.
  const none = {
    tierEnabled: false,
    providers: [{ id: 'idp_1', enabled: true, configured: true }],
    oauth: { password: false, magicLink: false } as Record<string, boolean | undefined>,
    emailConfigured: false,
    socialIds: ['google', 'github'],
    configuredSocialIds: new Set<string>(),
  }

  it('false when nothing works', () => {
    expect(hasAnyWorkingSignInMethod(none)).toBe(false)
  })

  it('true for a registered IdP (tier on)', () => {
    expect(hasAnyWorkingSignInMethod({ ...none, tierEnabled: true })).toBe(true)
  })

  it('true for password', () => {
    expect(hasAnyWorkingSignInMethod({ ...none, oauth: { magicLink: false } })).toBe(true)
  })

  it('true for magic link only when email delivery is wired', () => {
    expect(
      hasAnyWorkingSignInMethod({ ...none, oauth: { password: false, magicLink: true } })
    ).toBe(false)
    expect(
      hasAnyWorkingSignInMethod({
        ...none,
        oauth: { password: false, magicLink: true },
        emailConfigured: true,
      })
    ).toBe(true)
  })

  it('true for a social provider with saved credentials', () => {
    expect(
      hasAnyWorkingSignInMethod({
        ...none,
        oauth: { password: false, magicLink: false, google: true },
        configuredSocialIds: new Set(['google']),
      })
    ).toBe(true)
  })
})
