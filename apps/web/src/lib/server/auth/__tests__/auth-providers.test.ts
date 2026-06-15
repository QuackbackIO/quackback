import { describe, it, expect } from 'vitest'
import { authProviderCallbackPath } from '../auth-providers'

describe('authProviderCallbackPath', () => {
  // Custom OIDC is served by the genericOAuth plugin, whose callback lives at
  // /api/auth/oauth2/callback/<id> — not the social /api/auth/callback/<id>.
  it('uses the genericOAuth callback path for Custom OIDC', () => {
    expect(authProviderCallbackPath('custom-oidc')).toBe('/api/auth/oauth2/callback/custom-oidc')
  })

  it('uses the built-in social callback path for social providers', () => {
    expect(authProviderCallbackPath('google')).toBe('/api/auth/callback/google')
    expect(authProviderCallbackPath('github')).toBe('/api/auth/callback/github')
  })

  it('defaults to the social callback path for unknown providers', () => {
    expect(authProviderCallbackPath('mystery')).toBe('/api/auth/callback/mystery')
  })
})
