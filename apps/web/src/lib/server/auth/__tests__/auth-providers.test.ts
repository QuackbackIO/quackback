import { describe, it, expect } from 'vitest'
import { authProviderCallbackPath } from '../auth-providers'

describe('authProviderCallbackPath', () => {
  it('uses the Better Auth callback path for every provider', () => {
    expect(authProviderCallbackPath('custom-oidc')).toBe('/api/auth/callback/custom-oidc')
    expect(authProviderCallbackPath('google')).toBe('/api/auth/callback/google')
    expect(authProviderCallbackPath('github')).toBe('/api/auth/callback/github')
    expect(authProviderCallbackPath('oidc_abc')).toBe('/api/auth/callback/oidc_abc')
    expect(authProviderCallbackPath('mystery')).toBe('/api/auth/callback/mystery')
  })
})
