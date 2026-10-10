import { describe, it, expect } from 'vitest'
import {
  authProviderCallbackPath,
  getAuthProviderByProviderId,
  normalizeStoredAuthCredentials,
  socialProviderConfig,
} from '../auth-providers'

describe('authProviderCallbackPath', () => {
  it('uses the Better Auth callback path for every provider', () => {
    expect(authProviderCallbackPath('custom-oidc')).toBe('/api/auth/callback/custom-oidc')
    expect(authProviderCallbackPath('google')).toBe('/api/auth/callback/google')
    expect(authProviderCallbackPath('github')).toBe('/api/auth/callback/github')
    expect(authProviderCallbackPath('oidc_abc')).toBe('/api/auth/callback/oidc_abc')
    expect(authProviderCallbackPath('mystery')).toBe('/api/auth/callback/mystery')
  })
})

describe('Microsoft provider', () => {
  const microsoft = getAuthProviderByProviderId('microsoft')!

  it('labels the Entra directory field as the tenant ID', () => {
    const field = microsoft.platformCredentials.find((f) => f.label === 'Tenant ID')
    expect(field?.key).toBe('tenantId')
    expect(field?.helpText).toMatch(/Directory \(tenant\) ID/)
    expect(field?.helpText).toMatch(/common/)
    expect(field?.helpText).toMatch(/organizations/)
    expect(field?.helpText).toMatch(/consumers/)
  })

  it('passes the stored tenant ID to Better Auth as tenantId', () => {
    const config = socialProviderConfig(microsoft, {
      clientId: 'id',
      clientSecret: 'secret',
      tenantId: '11111111-2222-3333-4444-555555555555',
    })
    expect(config.tenantId).toBe('11111111-2222-3333-4444-555555555555')
    expect(config).not.toHaveProperty('workspaceKey')
  })

  it('reads a tenant ID stored under the workspaceKey field name', () => {
    const config = socialProviderConfig(microsoft, {
      clientId: 'id',
      clientSecret: 'secret',
      workspaceKey: 'contoso.onmicrosoft.com',
    })
    expect(config.tenantId).toBe('contoso.onmicrosoft.com')
    expect(config).not.toHaveProperty('workspaceKey')
  })

  it('prefers tenantId when both spellings are stored', () => {
    const creds = normalizeStoredAuthCredentials('auth_microsoft', {
      clientId: 'id',
      tenantId: 'organizations',
      workspaceKey: 'common',
    })
    expect(creds).toEqual({ clientId: 'id', tenantId: 'organizations' })
  })

  it('leaves other providers untouched', () => {
    const creds = { clientId: 'id', workspaceKey: 'x' }
    expect(normalizeStoredAuthCredentials('auth_google', creds)).toBe(creds)
  })

  it('omits the tenant when none is stored, so Better Auth defaults to common', () => {
    const config = socialProviderConfig(microsoft, { clientId: 'id', clientSecret: 'secret' })
    expect(config).not.toHaveProperty('tenantId')
    expect(config.clientId).toBe('id')
    expect(config.clientSecret).toBe('secret')
  })
})
