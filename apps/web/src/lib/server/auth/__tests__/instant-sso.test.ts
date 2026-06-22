import { describe, it, expect } from 'vitest'
import { resolveInstantSsoProvider } from '../instant-sso'

const oneProvider = [{ id: 'sso' }]

describe('resolveInstantSsoProvider', () => {
  it('returns the provider id when exactly one provider and no public password/magic-link', () => {
    expect(resolveInstantSsoProvider({ publicProviders: oneProvider, portalOauth: { password: false, magicLink: false } })).toBe('sso')
  })
  it('returns null when password is enabled (default true)', () => {
    expect(resolveInstantSsoProvider({ publicProviders: oneProvider, portalOauth: { magicLink: false } })).toBeNull()
  })
  it('returns null when magic-link is enabled', () => {
    expect(resolveInstantSsoProvider({ publicProviders: oneProvider, portalOauth: { password: false, magicLink: true } })).toBeNull()
  })
  it('returns null when there is not exactly one provider', () => {
    expect(resolveInstantSsoProvider({ publicProviders: [{ id: 'sso' }, { id: 'oidc_x' }], portalOauth: { password: false, magicLink: false } })).toBeNull()
    expect(resolveInstantSsoProvider({ publicProviders: [], portalOauth: { password: false, magicLink: false } })).toBeNull()
  })
  it('returns null when a social OAuth provider (google) is also enabled', () => {
    expect(
      resolveInstantSsoProvider({
        publicProviders: oneProvider,
        portalOauth: { password: false, magicLink: false, google: true },
      })
    ).toBeNull()
  })
  it('returns null when any social OAuth key is truthy alongside the single OIDC provider', () => {
    expect(
      resolveInstantSsoProvider({
        publicProviders: oneProvider,
        portalOauth: { password: false, magicLink: false, github: true },
      })
    ).toBeNull()
  })
  it('returns the provider id when the single OIDC provider is the only sign-in affordance', () => {
    // No password, no magic-link, no social OAuth — only the one OIDC provider
    expect(
      resolveInstantSsoProvider({
        publicProviders: [{ id: 'oidc_acme' }],
        portalOauth: { password: false, magicLink: false, google: false },
      })
    ).toBe('oidc_acme')
  })
})
