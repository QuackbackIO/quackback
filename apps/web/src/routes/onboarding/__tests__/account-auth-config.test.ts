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

  // Signing back in before setup finishes offers what the auth runtime
  // registered, the same list every other sign-in surface reads. Before setup
  // that is a password only: social providers are opt-in, and nothing has
  // opted in yet, whatever credentials the install holds.
  it('signs a returning account in with what the runtime registered', () => {
    expect(accountAuthConfig(null, []).signInOAuth).toEqual({ password: true })
    expect(accountAuthConfig(null, ['github']).signInOAuth).toEqual({
      password: true,
      github: true,
    })
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
