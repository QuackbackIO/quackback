import { describe, it, expect } from 'vitest'
import { countEnabledAuthMethods } from '../auth-method-count'

const base = {
  oauthState: {} as Record<string, boolean | undefined>,
  emailConfigured: true,
  credentialStatus: {} as Record<string, boolean>,
  identityProviders: [] as ReadonlyArray<{ enabled: boolean; configured: boolean }>,
}

describe('countEnabledAuthMethods', () => {
  it('counts an enabled password', () => {
    expect(countEnabledAuthMethods({ ...base, oauthState: { password: true } })).toBe(1)
  })

  it('counts magic link only when email delivery is configured', () => {
    expect(
      countEnabledAuthMethods({ ...base, oauthState: { magicLink: true }, emailConfigured: true })
    ).toBe(1)
    expect(
      countEnabledAuthMethods({ ...base, oauthState: { magicLink: true }, emailConfigured: false })
    ).toBe(0)
  })

  it('counts a social provider only when its credentials are saved', () => {
    expect(
      countEnabledAuthMethods({
        ...base,
        oauthState: { google: true },
        credentialStatus: { google: true },
      })
    ).toBe(1)
    expect(countEnabledAuthMethods({ ...base, oauthState: { google: true } })).toBe(0)
  })

  it('counts an enabled + configured identity provider', () => {
    expect(
      countEnabledAuthMethods({ ...base, identityProviders: [{ enabled: true, configured: true }] })
    ).toBe(1)
  })

  it('ignores an enabled-but-unconfigured identity provider (no secret, registers nothing)', () => {
    expect(
      countEnabledAuthMethods({
        ...base,
        identityProviders: [{ enabled: true, configured: false }],
      })
    ).toBe(0)
  })

  it('ignores a configured-but-disabled identity provider', () => {
    expect(
      countEnabledAuthMethods({
        ...base,
        identityProviders: [{ enabled: false, configured: true }],
      })
    ).toBe(0)
  })

  it('the reported bug: password + a working IdP total 2, so password is not the last method', () => {
    expect(
      countEnabledAuthMethods({
        ...base,
        oauthState: { password: true },
        identityProviders: [{ enabled: true, configured: true }],
      })
    ).toBe(2)
  })

  it('excludes the legacy email flag', () => {
    expect(countEnabledAuthMethods({ ...base, oauthState: { email: true } })).toBe(0)
  })
})
