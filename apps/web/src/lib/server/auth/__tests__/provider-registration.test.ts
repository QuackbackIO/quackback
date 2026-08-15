import { describe, it, expect, vi } from 'vitest'
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

  it('requests the broadly-supported prompt=login, not the OIDC-optional select_account', async () => {
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
    expect(cfgs[0].prompt).toBe('login')
  })

  it('omits the prompt parameter when the row is configured to send none', async () => {
    const cfgs = await buildGenericOAuthConfigs({
      providers: [
        {
          id: 'idp_abc',
          registrationId: 'sso',
          enabled: true,
          autoCreateUsers: true,
          discoveryUrl: 'https://x/.well-known/openid-configuration',
          prompt: 'omit',
        },
      ] as any,
      creds: async () => ({ clientId: 'c', clientSecret: 's' }),
      tierAllowsOidc: true,
    })
    expect(cfgs[0]).not.toHaveProperty('prompt')
  })

  it('sends a non-default prompt and token-auth method from the row', async () => {
    const cfgs = await buildGenericOAuthConfigs({
      providers: [
        {
          id: 'idp_abc',
          registrationId: 'sso',
          enabled: true,
          autoCreateUsers: true,
          discoveryUrl: 'https://x/.well-known/openid-configuration',
          prompt: 'consent',
          tokenEndpointAuthMethod: 'basic',
        },
      ] as any,
      creds: async () => ({ clientId: 'c', clientSecret: 's' }),
      tierAllowsOidc: true,
    })
    expect(cfgs[0].prompt).toBe('consent')
    expect(cfgs[0].authentication).toBe('basic')
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

describe('buildGenericOAuthConfigs identity cascade', () => {
  const idToken = (payload: Record<string, unknown>) =>
    `x.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.y`

  it('attaches a resolver to every provider', async () => {
    const cfgs = await buildGenericOAuthConfigs({
      providers: [
        {
          id: 'idp_abc',
          registrationId: 'oidc_abc',
          enabled: true,
          autoCreateUsers: true,
          discoveryUrl: 'https://x/.well-known/openid-configuration',
        },
      ] as any,
      creds: async () => ({ clientId: 'c', clientSecret: 's' }),
      tierAllowsOidc: true,
    })
    expect(cfgs[0].getUserInfo).toBeTypeOf('function')
  })

  it('reads CharacterID-style claims from an access-token-only mapping', async () => {
    const cfgs = await buildGenericOAuthConfigs({
      providers: [
        {
          id: 'idp_abc',
          registrationId: 'oidc_abc',
          enabled: true,
          autoCreateUsers: true,
          discoveryUrl: 'https://x/.well-known/openid-configuration',
          claimMapping: {
            profile: {
              sources: ['accessTokenJwt'],
              claims: { id: 'CharacterID', name: 'CharacterName' },
            },
          },
        },
      ] as any,
      creds: async () => ({ clientId: 'c', clientSecret: 's' }),
      tierAllowsOidc: true,
    })
    const info = await cfgs[0].getUserInfo?.({
      accessToken: idToken({ CharacterID: 42, CharacterName: 'Pilot' }),
    })
    expect(info?.id).toBe('42')
    expect(info?.name).toBe('Pilot')
  })

  it('asks for the placeholder by account identity so a returning user keeps theirs', async () => {
    const seen: Array<[string, string]> = []
    const cfgs = await buildGenericOAuthConfigs({
      providers: [
        {
          id: 'idp_abc',
          registrationId: 'oidc_abc',
          enabled: true,
          autoCreateUsers: true,
          discoveryUrl: 'https://x/.well-known/openid-configuration',
          claimMapping: { profile: { allowMissingEmail: true } },
        },
      ] as any,
      creds: async () => ({ clientId: 'c', clientSecret: 's' }),
      tierAllowsOidc: true,
      placeholderEmailFor: async (registrationId, accountId) => {
        seen.push([registrationId, accountId])
        return 'stored@anon.quackback.io'
      },
    })
    const first = await cfgs[0].getUserInfo?.({
      idToken: idToken({ sub: 'subject-9' }),
      accessToken: undefined,
    })
    const second = await cfgs[0].getUserInfo?.({
      idToken: idToken({ sub: 'subject-9' }),
      accessToken: undefined,
    })
    expect(seen).toEqual([
      ['oidc_abc', 'subject-9'],
      ['oidc_abc', 'subject-9'],
    ])
    expect(first?.email).toBe('stored@anon.quackback.io')
    expect(second?.email).toBe('stored@anon.quackback.io')
    expect(first?.emailVerified).toBe(false)
  })

  it('maps picture onto image so the avatar column still populates', async () => {
    const cfgs = await buildGenericOAuthConfigs({
      providers: [
        {
          id: 'idp_abc',
          registrationId: 'oidc_abc',
          enabled: true,
          autoCreateUsers: true,
          discoveryUrl: 'https://x/.well-known/openid-configuration',
        },
      ] as any,
      creds: async () => ({ clientId: 'c', clientSecret: 's' }),
      tierAllowsOidc: true,
    })
    const info = await cfgs[0].getUserInfo?.({
      idToken: idToken({
        sub: 's1',
        email: 'a@x.com',
        name: 'A',
        picture: 'https://idp.example/a.png',
      }),
    })
    expect(info?.image).toBe('https://idp.example/a.png')
  })

  it('resolves userinfo at request time when build-time discovery missed it', async () => {
    const discovery = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ userinfo_endpoint: 'https://idp/userinfo' })
    const fetchUserInfo = vi.fn(async () => ({
      sub: 's1',
      email: 'from-userinfo@x.com',
      groups: ['staff'],
    }))
    const cfgs = await buildGenericOAuthConfigs({
      providers: [
        {
          id: 'idp_abc',
          registrationId: 'oidc_abc',
          enabled: true,
          autoCreateUsers: true,
          discoveryUrl: 'https://x/.well-known/openid-configuration',
          userInfoUrl: null,
        },
      ] as any,
      creds: async () => ({ clientId: 'c', clientSecret: 's' }),
      tierAllowsOidc: true,
      discovery,
      fetchUserInfo,
    })
    const info = await cfgs[0].getUserInfo?.({
      idToken: idToken({ sub: 's1', name: 'A' }),
      accessToken: 'at',
    })
    expect(info?.email).toBe('from-userinfo@x.com')
    expect(info).not.toHaveProperty('groups')
    expect(fetchUserInfo).toHaveBeenCalledWith('https://idp/userinfo', 'at')
  })

  it('prefers the row userInfoUrl over request-time discovery', async () => {
    const discovery = vi.fn(async () => ({ userinfo_endpoint: 'https://discovered/userinfo' }))
    const fetchUserInfo = vi.fn(async () => ({ sub: 's1', email: 'row@x.com' }))
    const cfgs = await buildGenericOAuthConfigs({
      providers: [
        {
          id: 'idp_abc',
          registrationId: 'oidc_abc',
          enabled: true,
          autoCreateUsers: true,
          discoveryUrl: 'https://x/.well-known/openid-configuration',
          userInfoUrl: 'https://row/userinfo',
        },
      ] as any,
      creds: async () => ({ clientId: 'c', clientSecret: 's' }),
      tierAllowsOidc: true,
      discovery,
      fetchUserInfo,
    })
    await cfgs[0].getUserInfo?.({
      idToken: idToken({ sub: 's1' }),
      accessToken: 'at',
    })
    expect(fetchUserInfo).toHaveBeenCalledWith('https://row/userinfo', 'at')
  })

  it('does not mint when the provider has not opted in', async () => {
    const cfgs = await buildGenericOAuthConfigs({
      providers: [
        {
          id: 'idp_abc',
          registrationId: 'oidc_abc',
          enabled: true,
          autoCreateUsers: true,
          discoveryUrl: 'https://x/.well-known/openid-configuration',
        },
      ] as any,
      creds: async () => ({ clientId: 'c', clientSecret: 's' }),
      tierAllowsOidc: true,
      placeholderEmailFor: async () => 'should-not-be-used@anon.quackback.io',
    })
    const info = await cfgs[0].getUserInfo?.({
      idToken: idToken({ sub: 's1' }),
      accessToken: undefined,
    })
    expect(info?.email).toBeUndefined()
  })
})
