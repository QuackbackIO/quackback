import { describe, it, expect, vi } from 'vitest'
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

type BuildOpts = {
  creds?: (registrationId: string) => Promise<{ clientId?: string; clientSecret?: string } | null>
  tierAllowsOidc?: boolean
}

/** Build configs from the given rows, defaulting creds + tier to the happy path. */
async function buildConfigs(rows: Record<string, unknown>[], opts: BuildOpts = {}) {
  return buildGenericOAuthConfigs({
    providers: rows as never,
    creds: opts.creds ?? (async () => ({ clientId: 'c', clientSecret: 's' })),
    tierAllowsOidc: opts.tierAllowsOidc ?? true,
  })
}

/** The single-provider shorthand: one row of overrides, one config back. */
async function buildOne(over: Record<string, unknown> = {}, opts: BuildOpts = {}) {
  return (await buildConfigs([row(over)], opts))[0]
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
    const cfgs = await buildConfigs([row({ registrationId: 'sso' })])
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

  it('skips disabled providers and providers without credentials', async () => {
    const cfgs = await buildConfigs(
      [
        row({ id: 'idp_off', registrationId: 'oidc_idp_off', enabled: false }),
        row({ id: 'idp_nc', registrationId: 'oidc_idp_nc' }),
      ],
      {
        creds: async (rid) => (rid === 'oidc_idp_nc' ? null : { clientId: 'c', clientSecret: 's' }),
      }
    )
    expect(cfgs).toHaveLength(0)
  })

  it('returns no configs when the tier disallows OIDC', async () => {
    const cfgs = await buildConfigs([row({ registrationId: 'sso' })], { tierAllowsOidc: false })
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

/**
 * Discovery injection + resolver wiring.
 *
 * The plugin's `getUserInfo` seam is typed `(tokens) => Promise<UserInfo|null>`
 * and receives nothing else — not the discovery document the callback fetched
 * moments earlier, not the row. So the userinfo endpoint has to be closed over
 * at build time, or the resolver would have to re-fetch discovery on every
 * sign-in and the "no network on the fast path" property would be a fiction.
 *
 * Injected the same way credentials already are, which keeps this file free of
 * DB and fetch imports.
 */
describe('buildGenericOAuthConfigs discovery + resolver wiring', () => {
  const discoveryDoc = { userinfo_endpoint: 'https://idp/userinfo', issuer: 'https://idp' }

  it('resolves discovery once per build, not per sign-in', async () => {
    const discovery = vi.fn(async () => discoveryDoc)
    const cfgs = await buildGenericOAuthConfigs({
      providers: [row(), row({ id: 'idp_2', registrationId: 'oidc_2' })] as never,
      creds: async () => ({ clientId: 'c', clientSecret: 's' }),
      tierAllowsOidc: true,
      discovery,
    })
    expect(discovery).toHaveBeenCalledTimes(2) // once per provider, at build

    // Signing in must not fetch discovery again.
    discovery.mockClear()
    await cfgs[0].getUserInfo?.({ idToken: undefined, accessToken: undefined })
    expect(discovery).not.toHaveBeenCalled()
  })

  it('attaches a resolver to every provider, not just mapped ones', async () => {
    // The resolver is a superset of the default behaviour, so withholding it
    // from unmapped providers would leave two resolution paths again.
    const cfgs = await buildGenericOAuthConfigs({
      providers: [row()] as never,
      creds: async () => ({ clientId: 'c', clientSecret: 's' }),
      tierAllowsOidc: true,
      discovery: async () => discoveryDoc,
    })
    expect(cfgs[0].getUserInfo).toBeTypeOf('function')
  })

  it('prefers the row userInfoUrl over the discovery document', async () => {
    const discovery = vi.fn(async () => discoveryDoc)
    const cfgs = await buildGenericOAuthConfigs({
      providers: [row({ discoveryUrl: null, userInfoUrl: 'https://manual/userinfo' })] as never,
      creds: async () => ({ clientId: 'c', clientSecret: 's' }),
      tierAllowsOidc: true,
      discovery,
    })
    expect(cfgs[0].userInfoUrl).toBe('https://manual/userinfo')
    expect(discovery).not.toHaveBeenCalled()
  })

  it('still builds when discovery is unreachable', async () => {
    // A discovery outage must not stop the provider registering — a complete
    // ID token needs no userinfo at all.
    const cfgs = await buildGenericOAuthConfigs({
      providers: [row()] as never,
      creds: async () => ({ clientId: 'c', clientSecret: 's' }),
      tierAllowsOidc: true,
      discovery: async () => null,
    })
    expect(cfgs).toHaveLength(1)
    expect(cfgs[0].getUserInfo).toBeTypeOf('function')
  })
})

/**
 * World C: the provider releases a subject and nothing else. Sign-in fails on
 * `email_is_missing` today. The gap-fill runs last in the cascade, after every
 * real source has been tried, so it can never shadow an address the provider
 * actually sent.
 */
describe('gap-fill for providers that release no email or name', () => {
  const idToken = (payload: Record<string, unknown>) =>
    `x.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.y`

  /** Build one config with the gap-fill dependency injected. */
  async function buildWithPlaceholder(
    over: Record<string, unknown>,
    placeholderFor?: (registrationId: string, accountId: string) => Promise<string>
  ) {
    const cfgs = await buildGenericOAuthConfigs({
      providers: [row(over)] as never,
      creds: async () => ({ clientId: 'c', clientSecret: 's' }),
      tierAllowsOidc: true,
      ...(placeholderFor ? { placeholderEmailFor: placeholderFor } : {}),
    } as never)
    return cfgs[0]
  }

  it('leaves a provider that sends an email completely untouched', async () => {
    const cfg = await buildWithPlaceholder(
      { claimMapping: { profile: { allowMissingEmail: true } } },
      async () => 'should-not-be-used@anon.quackback.io'
    )
    const info = await cfg.getUserInfo?.({
      idToken: idToken({ sub: 's1', email: 'real@x.com', name: 'Real Person' }),
      accessToken: undefined,
    })
    expect(info?.email).toBe('real@x.com')
    expect(info?.name).toBe('Real Person')
  })

  it('does not mint when the provider has not opted in', async () => {
    // allowMissingEmail is off by default and minting is one-way, so an
    // unconfigured provider must keep failing rather than quietly create
    // accounts nobody can reach.
    const cfg = await buildWithPlaceholder({}, async () => 'minted@anon.quackback.io')
    const info = await cfg.getUserInfo?.({
      idToken: idToken({ sub: 's1' }),
      accessToken: undefined,
    })
    expect(info?.email).toBeUndefined()
  })

  it('mints an address when opted in and the provider sends none', async () => {
    const cfg = await buildWithPlaceholder(
      { claimMapping: { profile: { allowMissingEmail: true } } },
      async () => 'sso-oidc-abc-deadbeef@anon.quackback.io'
    )
    const info = await cfg.getUserInfo?.({
      idToken: idToken({ sub: 's1' }),
      accessToken: undefined,
    })
    expect(info?.email).toBe('sso-oidc-abc-deadbeef@anon.quackback.io')
  })

  it('asks for the address by account identity, so a returning user keeps theirs', async () => {
    // getUserInfo runs on EVERY sign-in. Minting unconditionally here would
    // hand a returning person a different address each time, so the dependency
    // is read-or-mint and is keyed by the subject.
    const seen: Array<[string, string]> = []
    const cfg = await buildWithPlaceholder(
      { claimMapping: { profile: { allowMissingEmail: true } } },
      async (registrationId, accountId) => {
        seen.push([registrationId, accountId])
        return 'stored@anon.quackback.io'
      }
    )
    await cfg.getUserInfo?.({ idToken: idToken({ sub: 'subject-9' }), accessToken: undefined })
    expect(seen).toEqual([['oidc_abc', 'subject-9']])
  })

  it('synthesizes a missing name without needing an opt-in', async () => {
    // A missing name only ever fails a sign-in that would otherwise work, and
    // a display name creates nothing irreversible, so it needs no switch.
    const cfg = await buildWithPlaceholder({})
    const info = await cfg.getUserInfo?.({
      idToken: idToken({ sub: 's1', email: 'real@x.com', preferred_username: 'somebody' }),
      accessToken: undefined,
    })
    expect(info?.name).toBe('somebody')
  })

  it('still resolves a name when the provider sends only a subject', async () => {
    const cfg = await buildWithPlaceholder({})
    const info = await cfg.getUserInfo?.({
      idToken: idToken({ sub: 'ACCOUNT:REGION:2119', email: 'real@x.com' }),
      accessToken: undefined,
    })
    expect(info?.name).toBeTruthy()
    expect(info?.name).not.toContain(':')
  })
})

/**
 * Better-Auth's genericOAuth only maps `userInfo.image` to the account avatar,
 * never the OIDC-standard `picture` claim, so `getUserInfo` has to promote it.
 */
describe('avatar from the OIDC `picture` claim', () => {
  const idToken = (payload: Record<string, unknown>) =>
    `x.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.y`

  it('returns `picture` as `image` so Better-Auth sets the avatar', async () => {
    const cfg = await buildOne()
    const info = await cfg.getUserInfo?.({
      idToken: idToken({
        sub: 's1',
        email: 'real@x.com',
        name: 'Real',
        picture: 'https://cdn.example.com/u/1.png',
      }),
      accessToken: undefined,
    })
    expect(info?.image).toBe('https://cdn.example.com/u/1.png')
  })

  it('omits `image` when the provider sends no usable picture', async () => {
    const cfg = await buildOne()
    const info = await cfg.getUserInfo?.({
      idToken: idToken({ sub: 's1', email: 'real@x.com', name: 'Real' }),
      accessToken: undefined,
    })
    expect(info && 'image' in info).toBe(false)
    // The rest of the profile is unaffected.
    expect(info?.email).toBe('real@x.com')
    expect(info?.name).toBe('Real')
  })

  it('ignores a `picture` that is not an http(s) URL', async () => {
    const cfg = await buildOne()
    const info = await cfg.getUserInfo?.({
      idToken: idToken({
        sub: 's1',
        email: 'real@x.com',
        picture: 'data:image/png;base64,iVBORw0KGgo=',
      }),
      accessToken: undefined,
    })
    expect(info && 'image' in info).toBe(false)
  })
})
