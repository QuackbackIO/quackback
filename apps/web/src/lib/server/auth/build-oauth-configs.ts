/**
 * Pure builder for the genericOAuth plugin's per-provider config list.
 *
 * Turns the `identity_provider` rows into Better-Auth genericOAuth configs.
 * Each provider registers under its own `registrationId` as the Better-Auth
 * `providerId`, so migrated rows (`'sso'` / `'custom-oidc'`) keep their
 * existing OAuth redirect URI and need no IdP reconfiguration.
 *
 * Credential sourcing: the IdP-owned client secret lives in
 * `platform_credentials` (read via `creds`), while `clientId`,
 * `discoveryUrl`, and the manual `authorizationUrl`/`tokenUrl` come from the
 * provider row columns. The backfilled `auth_sso` credential blob only
 * reliably carries `clientSecret` (its `clientId`/`discoveryUrl` are absent),
 * so the row is the source of truth for everything except the secret; the
 * row's `clientId` falls back to the credential's `clientId` when absent.
 *
 * Kept pure (no DB imports) so it can be unit-tested and so the auth builder
 * stays the only place that wires it to `listIdentityProviders` /
 * `getIdentityProviderCredentials`.
 */

import type { IdentityProvider } from '@/lib/server/domains/settings/identity-providers.service'
import type { IdentityProviderProfileMapping } from '@/lib/server/db'

/**
 * Default OIDC scopes requested when a provider has no explicit `scopes`.
 * The SSO test flow mirrors this exact set so a passing test exercises the
 * same scope request production sign-in will make.
 */
export const DEFAULT_OIDC_SCOPES = ['openid', 'email', 'profile'] as const

/**
 * Profile shape returned by a custom `getUserInfo`. The mapped identity
 * fields satisfy Better-Auth's `OAuth2UserInfo`; the raw claims are spread
 * alongside so `mapProfileToUser` (locale) still sees them.
 */
export type MappedUserInfo = {
  id: string
  name?: string
  email?: string
  image?: string
  emailVerified: boolean
} & Record<string, unknown>

/** A single entry in the genericOAuth plugin's `config` array. */
export interface GenericOAuthConfig {
  providerId: string
  clientId: string
  clientSecret: string
  disableSignUp?: boolean
  discoveryUrl?: string
  pkce?: boolean
  authorizationUrl?: string
  tokenUrl?: string
  scopes?: string[]
  /**
   * Custom user-info resolution, attached only when the provider row has a
   * `profile_mapping`. Replaces Better-Auth's id_token/userinfo default for
   * IdPs whose claims don't fit it (e.g. EVE Online: no id_token, no email,
   * identity in the JWT access token).
   */
  getUserInfo?: (tokens: {
    accessToken?: string
    idToken?: string
  }) => Promise<MappedUserInfo | null>
  mapProfileToUser?: (profile: unknown) => Record<string, unknown>
  // Force the IdP account picker so admins notice when they're already
  // signed in as a different identity.
  prompt?:
    | 'none'
    | 'login'
    | 'create'
    | 'consent'
    | 'select_account'
    | 'select_account consent'
    | 'login consent'
  // Emit `login_hint` to pre-select the typed email in the IdP picker.
  authorizationUrlParams?: (ctx: {
    body?: { additionalData?: { loginHint?: string } }
  }) => Record<string, string>
}

/**
 * Decrypted credentials for a provider. Looser than
 * `getIdentityProviderCredentials`' return type because the backfilled
 * `auth_sso` blob may omit `clientId`/`discoveryUrl`.
 */
export type ProviderCredentials = {
  clientId?: string
  clientSecret?: string
  discoveryUrl?: string
} | null

/** Resolve a dotted claim path (same convention as `attributeMapping.claimPath`). */
function resolveClaim(claims: Record<string, unknown>, path: string): unknown {
  // Namespaced claims (e.g. "https://acme.com/roles") contain dots that are
  // not path separators — prefer an exact key match before splitting.
  if (path in claims) return claims[path]
  let current: unknown = claims
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

/** Decode a JWT's payload without verification — mirrors how Better-Auth's
 *  generic-oauth login path treats id_tokens (bare `decodeJwt`). The token
 *  was just received first-hand from the IdP's token endpoint over TLS, so
 *  possession is the trust anchor; there is no third-party token to verify. */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'))
    return payload !== null && typeof payload === 'object'
      ? (payload as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/**
 * Synthesize an address from the `emailFallback` template. The `{id}`
 * placeholder is sanitized to `[a-z0-9._-]` so a structured id like EVE's
 * `CHARACTER:EVE:2119…` becomes a valid local part (`character.eve.2119…`).
 */
function synthesizeEmail(template: string, id: string): string {
  const sanitized = id
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
  return template.replaceAll('{id}', sanitized)
}

/**
 * Build the custom `getUserInfo` for a provider with a `profile_mapping`.
 *
 * Claim source is either the JWT access token's payload (`accessTokenJwt`)
 * or the provider's userinfo endpoint (`userinfo` — the row's `userInfoUrl`,
 * else resolved from the discovery document once and cached). Identity
 * fields resolve via the configured claim paths; a missing email falls back
 * to the `emailFallback` template (such users are marked emailVerified —
 * there is no real inbox to verify). Returns null (→ Better-Auth's
 * `user_info_is_missing` redirect) when claims can't be obtained or the id
 * claim is absent.
 */
export function buildProfileMappingGetUserInfo(
  provider: Pick<IdentityProvider, 'userInfoUrl' | 'discoveryUrl'>,
  mapping: IdentityProviderProfileMapping
): NonNullable<GenericOAuthConfig['getUserInfo']> {
  // Discovery resolution is once-per-auth-instance: the closure lives as
  // long as the built config, which resetAuth() discards on config change.
  let cachedUserInfoUrl: string | null = provider.userInfoUrl

  async function fetchClaims(accessToken: string): Promise<Record<string, unknown> | null> {
    if (!cachedUserInfoUrl && provider.discoveryUrl) {
      const res = await fetch(provider.discoveryUrl)
      if (!res.ok) return null
      const doc = (await res.json()) as { userinfo_endpoint?: unknown }
      if (typeof doc.userinfo_endpoint !== 'string') return null
      cachedUserInfoUrl = doc.userinfo_endpoint
    }
    if (!cachedUserInfoUrl) return null
    const res = await fetch(cachedUserInfoUrl, {
      headers: { authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return null
    const claims = (await res.json()) as unknown
    return claims !== null && typeof claims === 'object'
      ? (claims as Record<string, unknown>)
      : null
  }

  return async (tokens) => {
    if (!tokens.accessToken) return null

    const claims =
      mapping.source === 'accessTokenJwt'
        ? decodeJwtPayload(tokens.accessToken)
        : await fetchClaims(tokens.accessToken)
    if (!claims) return null

    const id = resolveClaim(claims, mapping.idClaim ?? 'sub')
    if (id === undefined || id === null || id === '') return null

    const name = resolveClaim(claims, mapping.nameClaim ?? 'name')
    const emailClaim = resolveClaim(claims, mapping.emailClaim ?? 'email')
    let email = typeof emailClaim === 'string' && emailClaim !== '' ? emailClaim : undefined
    let emailVerified = resolveClaim(claims, 'email_verified') === true
    if (!email && mapping.emailFallback) {
      email = synthesizeEmail(mapping.emailFallback, String(id))
      emailVerified = true
    }

    // A still-missing email is returned as-is so Better-Auth reports the
    // accurate `email_is_missing` (not `user_info_is_missing`).
    return {
      ...claims,
      id: String(id),
      ...(typeof name === 'string' && name !== '' ? { name } : {}),
      ...(email ? { email } : {}),
      emailVerified,
    }
  }
}

export interface BuildGenericOAuthConfigsArgs {
  providers: IdentityProvider[]
  /** Fetches the decrypted credential blob for a provider's registrationId. */
  creds: (registrationId: string) => Promise<ProviderCredentials>
  /** `tierLimits.features.customOidcProvider` — gates ALL OIDC registration. */
  tierAllowsOidc: boolean
  /** Attached to every config so `user.locale` populates from sign-in. */
  mapProfileToUser?: (profile: unknown) => Record<string, unknown>
  /**
   * Builds the `login_hint` authorizationUrlParams. Carried to EVERY
   * provider (any provider may be domain-routed), not just the legacy sso one.
   */
  buildLoginHintParams?: (ctx: {
    body?: { additionalData?: { loginHint?: string } }
  }) => Record<string, string>
}

/**
 * Build one genericOAuth config per registrable provider. A provider is
 * registrable iff the tier allows OIDC, the provider row is enabled, and a
 * client secret exists. The gate mirrors what the auth runtime registers, so
 * the UI mirror (`registered-providers.ts`) can reproduce it exactly.
 */
export async function buildGenericOAuthConfigs({
  providers,
  creds,
  tierAllowsOidc,
  mapProfileToUser,
  buildLoginHintParams,
}: BuildGenericOAuthConfigsArgs): Promise<GenericOAuthConfig[]> {
  // Defense-in-depth: a workspace downgraded off the OIDC tier keeps its
  // provider rows in the DB. Skip registration so no login button renders
  // and the /sign-in/oauth2 callback path 404s on those providerIds.
  if (!tierAllowsOidc) return []

  const configs: GenericOAuthConfig[] = []

  for (const provider of providers) {
    if (!provider.enabled) continue

    // Secret comes from platform_credentials; the rest from the row.
    const c = await creds(provider.registrationId)
    if (!c?.clientSecret) continue

    const clientId = provider.clientId || c.clientId || ''
    const discoveryUrl = provider.discoveryUrl || c.discoveryUrl || undefined
    const authorizationUrl = provider.authorizationUrl || undefined
    const tokenUrl = provider.tokenUrl || undefined

    configs.push({
      providerId: provider.registrationId,
      clientId,
      clientSecret: c.clientSecret,
      ...(discoveryUrl ? { discoveryUrl } : {}),
      ...(authorizationUrl ? { authorizationUrl } : {}),
      ...(tokenUrl ? { tokenUrl } : {}),
      scopes: provider.scopes
        ? provider.scopes.split(/\s+/).filter(Boolean)
        : [...DEFAULT_OIDC_SCOPES],
      // PKCE on every provider. OAuth 2.1 IdPs require code_challenge and
      // reject without it; RFC 7636 §5 makes the params backwards-compatible
      // (IdPs without PKCE support simply ignore them).
      pkce: true,
      // Force the account picker so an admin typing a specific email isn't
      // silently signed in as whoever the IdP already has a session for.
      prompt: 'select_account',
      // Better-Auth's JIT block. When false, the OAuth callback aborts in
      // handleOAuthUserInfo before any user/session is created. Existing
      // users still link via accountLinking.trustedProviders.
      disableSignUp: provider.autoCreateUsers === false,
      // Custom profile-claim resolution (opt-in via the profile_mapping
      // column) for IdPs whose user info doesn't fit the OIDC defaults.
      ...(provider.profileMapping
        ? { getUserInfo: buildProfileMappingGetUserInfo(provider, provider.profileMapping) }
        : {}),
      ...(mapProfileToUser ? { mapProfileToUser } : {}),
      ...(buildLoginHintParams ? { authorizationUrlParams: buildLoginHintParams } : {}),
    })
  }

  return configs
}
