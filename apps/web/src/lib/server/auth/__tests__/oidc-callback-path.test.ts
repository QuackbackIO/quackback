import { describe, it, expect } from 'vitest'
import { isOidcCallbackPath, oidcCallbackProviderId } from '../oidc-callback-path'

describe('oidc callback path helpers', () => {
  it('accepts both the legacy genericOAuth template and the 1.7 social template', () => {
    expect(isOidcCallbackPath('/oauth2/callback/:providerId')).toBe(true)
    expect(isOidcCallbackPath('/callback/:id')).toBe(true)
    expect(isOidcCallbackPath('/sign-in/social')).toBe(false)
  })

  it('reads providerId from the matching param on each template', () => {
    expect(
      oidcCallbackProviderId({
        path: '/oauth2/callback/:providerId',
        params: { providerId: 'acme-idp' },
      })
    ).toBe('acme-idp')
    expect(
      oidcCallbackProviderId({
        path: '/callback/:id',
        params: { id: 'acme-idp' },
      })
    ).toBe('acme-idp')
    expect(
      oidcCallbackProviderId({ path: '/callback/:id', params: { providerId: 'nope' } })
    ).toBeNull()
  })
})
