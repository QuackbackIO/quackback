import { describe, it, expect } from 'vitest'
import { buildGenericOAuthConfigs } from '../build-oauth-configs'
import { getAllAuthProviders } from '../auth-providers'

describe('buildGenericOAuthConfigs', () => {
  it('registers one config per enabled provider under its registrationId', async () => {
    const cfgs = await buildGenericOAuthConfigs({
      providers: [
        {
          id: 'idp_abc',
          registrationId: 'sso',
          enabled: true,
          autoCreateUsers: true,
          discoveryUrl: 'https://x/.well-known/openid-configuration',
        },
      ] as any,
      creds: async () => ({ clientId: 'c', clientSecret: 's' }),
      tierAllowsOidc: true,
    })
    expect(cfgs).toHaveLength(1)
    expect(cfgs[0].providerId).toBe('sso') // preserved registration id, NOT oidc_idp_abc
    expect(cfgs[0].pkce).toBe(true)
    expect(cfgs[0].disableSignUp).toBe(false)
  })

  it('skips disabled providers and providers without credentials', async () => {
    const cfgs = await buildGenericOAuthConfigs({
      providers: [
        { id: 'idp_off', registrationId: 'oidc_idp_off', enabled: false },
        { id: 'idp_nc', registrationId: 'oidc_idp_nc', enabled: true },
      ] as any,
      creds: async (rid: string) =>
        rid === 'oidc_idp_nc' ? null : { clientId: 'c', clientSecret: 's' },
      tierAllowsOidc: true,
    })
    expect(cfgs).toHaveLength(0)
  })

  it('returns no configs when the tier disallows OIDC', async () => {
    const cfgs = await buildGenericOAuthConfigs({
      providers: [
        {
          id: 'idp_abc',
          registrationId: 'sso',
          enabled: true,
          autoCreateUsers: true,
          discoveryUrl: 'https://x/.well-known/openid-configuration',
        },
      ] as any,
      creds: async () => ({ clientId: 'c', clientSecret: 's' }),
      tierAllowsOidc: false,
    })
    expect(cfgs).toHaveLength(0)
  })
})

describe('social provider registration regression (H3)', () => {
  it('still exposes the 10 built-in social providers for the social loop', () => {
    // After OIDC moved to the identity_provider list, the only
    // generic-oauth entry in AUTH_PROVIDERS is custom-oidc; the rest are
    // social and must keep registering via the getAllAuthProviders() loop.
    const social = getAllAuthProviders().filter((p) => p.type !== 'generic-oauth')
    expect(social.map((p) => p.id).sort()).toEqual(
      [
        'apple',
        'discord',
        'facebook',
        'github',
        'gitlab',
        'google',
        'linkedin',
        'microsoft',
        'reddit',
        'twitter',
      ].sort()
    )
    const generic = getAllAuthProviders().filter((p) => p.type === 'generic-oauth')
    expect(generic.map((p) => p.id)).toEqual(['custom-oidc'])
  })
})
