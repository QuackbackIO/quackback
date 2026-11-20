import { describe, it, expect } from 'vitest'
import { countEnabledAuthMethods, isProviderLastWayIn } from '../auth-method-count'

const base = {
  // password is on by default (absent ⇒ on); disable it in the base so each
  // case isolates the method under test. Default-on behaviour has its own tests.
  oauthState: { password: false } as Record<string, boolean | undefined>,
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
      countEnabledAuthMethods({
        ...base,
        oauthState: { password: false, magicLink: true },
        emailConfigured: true,
      })
    ).toBe(1)
    expect(
      countEnabledAuthMethods({
        ...base,
        oauthState: { password: false, magicLink: true },
        emailConfigured: false,
      })
    ).toBe(0)
  })

  it('counts a social provider only when its credentials are saved', () => {
    expect(
      countEnabledAuthMethods({
        ...base,
        oauthState: { password: false, google: true },
        credentialStatus: { google: true },
      })
    ).toBe(1)
    expect(
      countEnabledAuthMethods({ ...base, oauthState: { password: false, google: true } })
    ).toBe(0)
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
    expect(countEnabledAuthMethods({ ...base, oauthState: { password: false, email: true } })).toBe(
      0
    )
  })

  it('counts default-on password when the key is absent (upgraded/default config)', () => {
    // The reported bug: an absent `password` key still means password is on, so
    // it must count — otherwise the UI undercounts and can disable the last
    // remaining IdP/social control even though password is a working fallback.
    expect(countEnabledAuthMethods({ ...base, oauthState: {} })).toBe(1)
    expect(
      countEnabledAuthMethods({
        ...base,
        oauthState: {},
        identityProviders: [{ enabled: true, configured: true }],
      })
    ).toBe(2)
  })

  it('does not count an explicitly disabled password', () => {
    expect(countEnabledAuthMethods({ ...base, oauthState: { password: false } })).toBe(0)
  })
})

describe('countEnabledAuthMethods without single sign-on live', () => {
  const setUp = { id: 'idp_1', enabled: true, configured: true }
  const ssoOnly = { ...base, oauthState: { password: false, magicLink: false } }

  it('counts the email links that stand in for a set-up provider, not the provider', () => {
    expect(
      countEnabledAuthMethods({ ...ssoOnly, identityProviders: [setUp], ssoLive: false })
    ).toBe(1)
  })

  it('counts nothing when email delivery is not wired', () => {
    expect(
      countEnabledAuthMethods({
        ...ssoOnly,
        emailConfigured: false,
        identityProviders: [setUp],
        ssoLive: false,
      })
    ).toBe(0)
  })

  it('does not count email links twice when they are already on', () => {
    expect(
      countEnabledAuthMethods({
        ...base,
        oauthState: { password: false, magicLink: true },
        identityProviders: [setUp],
        ssoLive: false,
      })
    ).toBe(1)
  })
})

describe('isProviderLastWayIn', () => {
  const a = { id: 'idp_a', enabled: true, configured: true }
  const b = { id: 'idp_b', enabled: true, configured: true }
  const ssoOnly = { ...base, oauthState: { password: false, magicLink: false } }

  it('is true for the sole working provider while single sign-on is live', () => {
    expect(
      isProviderLastWayIn({ ...ssoOnly, identityProviders: [a], ssoLive: true }, 'idp_a')
    ).toBe(true)
  })

  it('is true with single sign-on off when the provider keeps the email links on', () => {
    expect(
      isProviderLastWayIn({ ...ssoOnly, identityProviders: [a], ssoLive: false }, 'idp_a')
    ).toBe(true)
  })

  it('is false with single sign-on off when another provider keeps them on', () => {
    expect(
      isProviderLastWayIn({ ...ssoOnly, identityProviders: [a, b], ssoLive: false }, 'idp_a')
    ).toBe(false)
  })

  it('is false with single sign-on off when password stays on', () => {
    expect(
      isProviderLastWayIn(
        { ...base, oauthState: { password: true }, identityProviders: [a], ssoLive: false },
        'idp_a'
      )
    ).toBe(false)
  })

  it('is false for a provider that is switched off', () => {
    expect(
      isProviderLastWayIn(
        { ...ssoOnly, identityProviders: [{ ...a, enabled: false }], ssoLive: false },
        'idp_a'
      )
    ).toBe(false)
  })
})
