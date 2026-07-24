import { describe, it, expect, afterEach, vi } from 'vitest'
import { buildGenericOAuthConfigs, buildProfileMappingGetUserInfo } from '../build-oauth-configs'
import { getAllAuthProviders } from '../auth-providers'

/** Unsigned JWT with the given payload — the login path never verifies. */
function fakeJwt(payload: Record<string, unknown>): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.sig`
}

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

describe('profile mapping (getUserInfo)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('attaches getUserInfo only when the provider has a profileMapping', async () => {
    const cfgs = await buildGenericOAuthConfigs({
      providers: [
        {
          id: 'idp_plain',
          registrationId: 'oidc_plain',
          enabled: true,
          autoCreateUsers: true,
          discoveryUrl: 'https://x/.well-known/openid-configuration',
        },
        {
          id: 'idp_eve',
          registrationId: 'oidc_eve',
          enabled: true,
          autoCreateUsers: true,
          discoveryUrl: 'https://login.eveonline.com/.well-known/openid-configuration',
          profileMapping: { source: 'accessTokenJwt' },
        },
      ] as any,
      creds: async () => ({ clientId: 'c', clientSecret: 's' }),
      tierAllowsOidc: true,
    })
    expect(cfgs).toHaveLength(2)
    expect(cfgs.find((c) => c.providerId === 'oidc_plain')?.getUserInfo).toBeUndefined()
    expect(cfgs.find((c) => c.providerId === 'oidc_eve')?.getUserInfo).toBeTypeOf('function')
  })

  it('accessTokenJwt: decodes the access token and synthesizes a sanitized fallback email', async () => {
    const getUserInfo = buildProfileMappingGetUserInfo(
      { userInfoUrl: null, discoveryUrl: 'https://login.eveonline.com/.well-known/oidc' },
      { source: 'accessTokenJwt', emailFallback: '{id}@eve.example.com' }
    )
    const user = await getUserInfo({
      accessToken: fakeJwt({
        sub: 'CHARACTER:EVE:2119123456',
        name: 'Some Pilot',
        owner: 'abc123=',
      }),
    })
    expect(user).toMatchObject({
      id: 'CHARACTER:EVE:2119123456',
      name: 'Some Pilot',
      email: 'character.eve.2119123456@eve.example.com',
      emailVerified: true,
    })
    // Raw claims are spread through for mapProfileToUser consumers.
    expect(user?.owner).toBe('abc123=')
  })

  it('accessTokenJwt: prefers a real email claim over the fallback', async () => {
    const getUserInfo = buildProfileMappingGetUserInfo(
      { userInfoUrl: null, discoveryUrl: null },
      { source: 'accessTokenJwt', emailFallback: '{id}@sso.example.com' }
    )
    const user = await getUserInfo({
      accessToken: fakeJwt({ sub: 'u1', name: 'N', email: 'real@example.com' }),
    })
    expect(user?.email).toBe('real@example.com')
    // Claim-sourced email is only verified when the IdP says so.
    expect(user?.emailVerified).toBe(false)
  })

  it('accessTokenJwt: returns null on a malformed token or missing id claim', async () => {
    const getUserInfo = buildProfileMappingGetUserInfo(
      { userInfoUrl: null, discoveryUrl: null },
      { source: 'accessTokenJwt' }
    )
    expect(await getUserInfo({ accessToken: 'not-a-jwt' })).toBeNull()
    expect(await getUserInfo({})).toBeNull()
    expect(await getUserInfo({ accessToken: fakeJwt({ name: 'no sub here' }) })).toBeNull()
  })

  it('accessTokenJwt: omits email when absent and no fallback is configured', async () => {
    // Better-Auth then reports the accurate email_is_missing error.
    const getUserInfo = buildProfileMappingGetUserInfo(
      { userInfoUrl: null, discoveryUrl: null },
      { source: 'accessTokenJwt' }
    )
    const user = await getUserInfo({ accessToken: fakeJwt({ sub: 'u1', name: 'N' }) })
    expect(user?.id).toBe('u1')
    expect(user?.email).toBeUndefined()
  })

  it('userinfo: fetches the row userInfoUrl with the bearer token and maps custom claim paths', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        CharacterID: 2119123456,
        CharacterName: 'Some Pilot',
        email_verified: true,
        contact: { email: 'pilot@example.com' },
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const getUserInfo = buildProfileMappingGetUserInfo(
      { userInfoUrl: 'https://idp.example.com/userinfo', discoveryUrl: null },
      {
        source: 'userinfo',
        idClaim: 'CharacterID',
        nameClaim: 'CharacterName',
        emailClaim: 'contact.email',
      }
    )
    const user = await getUserInfo({ accessToken: 'opaque-token' })
    expect(fetchMock).toHaveBeenCalledWith('https://idp.example.com/userinfo', {
      headers: { authorization: 'Bearer opaque-token' },
    })
    expect(user).toMatchObject({
      id: '2119123456',
      name: 'Some Pilot',
      email: 'pilot@example.com',
      emailVerified: true,
    })
  })

  it('userinfo: resolves the endpoint from discovery once and caches it', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url === 'https://idp.example.com/.well-known/openid-configuration'
        ? { ok: true, json: async () => ({ userinfo_endpoint: 'https://idp.example.com/me' }) }
        : { ok: true, json: async () => ({ sub: 'u1', name: 'N', email: 'e@example.com' }) }
    )
    vi.stubGlobal('fetch', fetchMock)

    const getUserInfo = buildProfileMappingGetUserInfo(
      {
        userInfoUrl: null,
        discoveryUrl: 'https://idp.example.com/.well-known/openid-configuration',
      },
      { source: 'userinfo' }
    )
    expect((await getUserInfo({ accessToken: 't1' }))?.id).toBe('u1')
    expect((await getUserInfo({ accessToken: 't2' }))?.id).toBe('u1')
    // 1 discovery fetch + 2 userinfo fetches — discovery cached after the first.
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('userinfo: returns null when the userinfo fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, json: async () => ({}) }))
    )
    const getUserInfo = buildProfileMappingGetUserInfo(
      { userInfoUrl: 'https://idp.example.com/userinfo', discoveryUrl: null },
      { source: 'userinfo' }
    )
    expect(await getUserInfo({ accessToken: 't' })).toBeNull()
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
