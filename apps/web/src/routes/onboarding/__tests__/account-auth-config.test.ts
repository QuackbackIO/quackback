import { describe, it, expect } from 'vitest'
import { accountAuthConfig } from '../-account-auth-config'

describe('accountAuthConfig', () => {
  // A fresh install has no settings row until the workspace step saves one.
  // The shipped default lists Google and GitHub as on, but that is the toggle's
  // default, not credentials anyone configured: offering them renders buttons
  // that fail.
  it('offers only a password before the workspace has settings', () => {
    const config = accountAuthConfig(null, [])

    expect(config.found).toBe(false)
    expect(config.oauth).toEqual({ password: true })
  })

  // Someone may have created their account with a configured provider before
  // setup finished. Signing back in offers what the credentials allow.
  it('signs a returning account in with the configured providers before setup', () => {
    const config = accountAuthConfig(null, [], { password: true, github: true, google: false })

    expect(config.oauth).toEqual({ password: true })
    expect(config.signInOAuth).toEqual({ password: true, github: true, google: false })
  })

  it('passes a set-up workspace through unchanged', () => {
    const config = accountAuthConfig(
      {
        publicAuthConfig: {
          oauth: { github: true, password: false, magicLink: true },
          openSignup: false,
          twoFactor: { required: true },
        },
        publicPortalConfig: {
          oidcProviders: [{ id: 'okta', name: 'Okta', logoUrl: null }],
        },
      },
      ['github']
    )

    expect(config).toEqual({
      found: true,
      oauth: { github: true, password: false, magicLink: true },
      openSignup: false,
      oidcProviders: [{ id: 'okta', name: 'Okta', logoUrl: null }],
      registeredAuthProviders: ['github'],
      twoFactorRequired: true,
      signInOAuth: { github: true, password: false, magicLink: true },
    })
  })
})
