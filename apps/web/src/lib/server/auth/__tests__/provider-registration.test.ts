import { describe, it, expect } from 'vitest'
import {
  buildGenericOAuthConfigs,
  effectiveScopes,
  DEFAULT_OIDC_SCOPES,
} from '../build-oauth-configs'
import { getAllAuthProviders } from '../auth-providers'

/** Minimal enabled provider row for the builder. */
function row(over: Record<string, unknown> = {}) {
  return {
    id: 'idp_abc',
    registrationId: 'oidc_abc',
    enabled: true,
    autoCreateUsers: true,
    discoveryUrl: 'https://x/.well-known/openid-configuration',
    ...over,
  }
}

async function buildOne(over: Record<string, unknown> = {}) {
  const cfgs = await buildGenericOAuthConfigs({
    providers: [row(over)] as never,
    creds: async () => ({ clientId: 'c', clientSecret: 's' }),
    tierAllowsOidc: true,
  })
  return cfgs[0]
}

describe('effectiveScopes', () => {
  it('falls back to the default set for null', () => {
    expect(effectiveScopes({ scopes: null })).toEqual([...DEFAULT_OIDC_SCOPES])
  })

  it('treats a blank or whitespace-only column as unset, not as "no scopes"', () => {
    // Regression: registration branched on truthiness ('' -> defaults) while the
    // SSO test used ?? ('' -> empty scope), so a stored blank made the test
    // exercise a different scope set from production.
    expect(effectiveScopes({ scopes: '' })).toEqual([...DEFAULT_OIDC_SCOPES])
    expect(effectiveScopes({ scopes: '   ' })).toEqual([...DEFAULT_OIDC_SCOPES])
  })

  it('splits on whitespace and collapses runs', () => {
    expect(effectiveScopes({ scopes: 'openid   public' })).toEqual(['openid', 'public'])
  })

  it('splits comma-joined values, which the column is documented to allow', () => {
    expect(effectiveScopes({ scopes: 'openid,public' })).toEqual(['openid', 'public'])
    expect(effectiveScopes({ scopes: 'openid, public' })).toEqual(['openid', 'public'])
  })

  it('preserves a custom set verbatim', () => {
    expect(effectiveScopes({ scopes: 'openid public' })).toEqual(['openid', 'public'])
  })
})

describe('buildGenericOAuthConfigs scope + userinfo wiring', () => {
  it('requests the effective scopes, not the raw column', async () => {
    expect((await buildOne({ scopes: '' }))?.scopes).toEqual([...DEFAULT_OIDC_SCOPES])
    expect((await buildOne({ scopes: 'openid public' }))?.scopes).toEqual(['openid', 'public'])
  })

  it('forwards the row userInfoUrl so the userinfo fallback has a target', async () => {
    // Without this the plugin's id_token -> userinfo fallback resolves
    // undefined for a manual-endpoint provider and the callback aborts with
    // user_info_is_missing, even though the connection test honours the column.
    const cfg = await buildOne({
      discoveryUrl: null,
      authorizationUrl: 'https://idp/authorize',
      tokenUrl: 'https://idp/token',
      userInfoUrl: 'https://idp/userinfo',
    })
    expect(cfg?.userInfoUrl).toBe('https://idp/userinfo')
  })

  it('omits userInfoUrl when the row has none', async () => {
    expect(await buildOne({ userInfoUrl: null })).not.toHaveProperty('userInfoUrl')
  })
})

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
