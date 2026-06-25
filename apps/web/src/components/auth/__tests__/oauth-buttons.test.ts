import { describe, it, expect } from 'vitest'
import {
  hasAnyPortalAuthMethod,
  hasRoutableOidcProvider,
  resolveSoleOidcProvider,
} from '../oauth-buttons'

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

  it('returns true for a routed-only OIDC provider with no public button (the reported bug)', () => {
    // Only an Entra IdP, routed by a verified domain, password + magic link off:
    // no public button renders, but the "Log in" entry point must still appear.
    expect(
      hasAnyPortalAuthMethod(
        { password: false, magicLink: false },
        { registeredAuthProviders: ['oidc_0habmo4o'] }
      )
    ).toBe(true)
  })

  it('returns true for a registered legacy sso / custom-oidc provider', () => {
    expect(
      hasAnyPortalAuthMethod(
        { password: false, magicLink: false },
        { registeredAuthProviders: ['sso'] }
      )
    ).toBe(true)
    expect(
      hasAnyPortalAuthMethod(
        { password: false, magicLink: false },
        { registeredAuthProviders: ['custom-oidc'] }
      )
    ).toBe(true)
  })

  it('returns true for a public-button OIDC provider from oidcProviders', () => {
    expect(
      hasAnyPortalAuthMethod(
        { password: false, magicLink: false },
        { oidcProviders: [{ id: 'oidc_x', name: 'Acme' }] }
      )
    ).toBe(true)
  })

  it('does not count a social provider registered globally but disabled on the portal', () => {
    // `google` registered (team-side) but the portal oauth flag is off — not a
    // portal sign-in path, and social ids never count as OIDC providers.
    expect(
      hasAnyPortalAuthMethod(
        { password: false, magicLink: false, google: false },
        { registeredAuthProviders: ['google'] }
      )
    ).toBe(false)
  })
})

describe('hasRoutableOidcProvider', () => {
  it('true for a registered OIDC provider with no public button (routed-only)', () => {
    expect(hasRoutableOidcProvider(['oidc_entra'])).toBe(true)
    expect(hasRoutableOidcProvider(['sso'])).toBe(true)
  })

  it('false when the OIDC provider is a public button (already has its own tile)', () => {
    expect(hasRoutableOidcProvider(['oidc_entra'], [{ id: 'oidc_entra', name: 'Entra' }])).toBe(
      false
    )
  })

  it('false for social ids (gated by portal toggles, not routed by domain)', () => {
    expect(hasRoutableOidcProvider(['google', 'github'])).toBe(false)
  })

  it('true when a routed-only provider sits alongside a public one', () => {
    expect(
      hasRoutableOidcProvider(['oidc_public', 'oidc_routed'], [{ id: 'oidc_public', name: 'Pub' }])
    ).toBe(true)
  })

  it('false for empty / missing input', () => {
    expect(hasRoutableOidcProvider([])).toBe(false)
    expect(hasRoutableOidcProvider(undefined)).toBe(false)
  })
})

describe('resolveSoleOidcProvider', () => {
  it('returns the provider id when it is the only sign-in method', () => {
    expect(resolveSoleOidcProvider(['oidc_entra'], { password: false, magicLink: false })).toBe(
      'oidc_entra'
    )
  })

  it('returns null when password is still enabled (user has a choice)', () => {
    expect(resolveSoleOidcProvider(['oidc_entra'], { password: true, magicLink: false })).toBeNull()
    // Password defaults on when the key is absent.
    expect(resolveSoleOidcProvider(['oidc_entra'], {})).toBeNull()
  })

  it('returns null when magic link is enabled', () => {
    expect(resolveSoleOidcProvider(['oidc_entra'], { password: false, magicLink: true })).toBeNull()
  })

  it('returns null when a social provider is also registered', () => {
    expect(
      resolveSoleOidcProvider(['oidc_entra', 'google'], { password: false, magicLink: false })
    ).toBeNull()
  })

  it('returns null when more than one IdP is registered', () => {
    expect(
      resolveSoleOidcProvider(['oidc_entra', 'oidc_okta'], { password: false, magicLink: false })
    ).toBeNull()
  })

  it('returns null when no provider is registered', () => {
    expect(resolveSoleOidcProvider([], { password: false, magicLink: false })).toBeNull()
    expect(resolveSoleOidcProvider(undefined, { password: false, magicLink: false })).toBeNull()
  })
})
