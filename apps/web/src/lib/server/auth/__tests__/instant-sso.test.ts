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
})
