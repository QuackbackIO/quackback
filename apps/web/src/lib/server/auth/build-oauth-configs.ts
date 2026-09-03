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
import { authorizeRequestFor, supportsPrompt } from '@/lib/shared/oidc-request'
import { resolveIdentity, pickAvatarUrl } from './resolve-identity'
import { synthesizeName } from './placeholder-identity'
import { allowsMissingEmail } from '@/lib/shared/oidc-claim-mapping'

// Re-exported so server callers keep this import path. The implementation lives
// in `shared` because the admin editor needs it too, and having exactly one
// scope resolver is the whole point — see oidc-scopes.ts. The connection test
// mirrors this same set, so a passing test exercises the scope request that
// production sign-in will actually make.
export { DEFAULT_OIDC_SCOPES, effectiveScopes } from '@/lib/shared/oidc-scopes'

/**
 * What the resolver hands back to the plugin. Mirrors the library's
 * `OAuth2UserInfo` while staying open, because the raw claims ride along and
 * `mapProfileToUser` reads them for locale and avatar.
 */
export type ResolvedProfile = {
  id: string
  email?: string
  name?: string
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
  /** Manual-endpoint userinfo URL. Without this the plugin's id_token →
   *  userinfo fallback has nowhere to go for a provider with no discovery
   *  document, and the callback aborts with `user_info_is_missing`. */
  userInfoUrl?: string
  /** Custom user-info resolution. Attached to EVERY provider — it is a superset
   *  of the plugin's own behaviour, so leaving it off any provider would
   *  reinstate a second resolution path. */
  getUserInfo?: (tokens: {
    idToken?: string
    accessToken?: string
  }) => Promise<ResolvedProfile | null>
  scopes?: string[]
  /** How the client secret reaches the token endpoint. Some providers accept
   *  only one of the two, and this was previously fixed in code. */
  authentication?: 'basic' | 'post'
  mapProfileToUser?: (profile: unknown) => Record<string, unknown>
  // Default prompt is `login` (see DEFAULT_OIDC_PROMPT). select_account is
  // OIDC-optional and many IdPs ignore or reject it.
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

export interface BuildGenericOAuthConfigsArgs {
  providers: IdentityProvider[]
  /** Fetches the decrypted credential blob for a provider's registrationId. */
  creds: (registrationId: string) => Promise<ProviderCredentials>
  /** `tierLimits.features.customOidcProvider` — gates ALL OIDC registration. */
  tierAllowsOidc: boolean
  /**
   * Fetches a provider's discovery document, or null when it is unreachable.
   *
   * Injected the same way `creds` is, which keeps this module free of fetch and
   * DB imports. Resolution happens HERE, at build time, because the plugin's
   * `getUserInfo` seam receives only the token set — not the discovery document
   * the callback fetched moments earlier. Without closing the endpoint over at
   * build time the resolver would have to re-fetch discovery on every sign-in,
   * and the fast path's "no network" property would not be real.
   */
  discovery?: (
    discoveryUrl: string
  ) => Promise<{ userinfo_endpoint?: unknown; prompt_values_supported?: unknown } | null>
  /** Fetches a userinfo document with the bearer token. Injected for the same
   *  reason as `discovery`: the guarded fetch belongs outside this module. */
  fetchUserInfo?: (url: string, accessToken: string) => Promise<Record<string, unknown> | null>
  /** Called when resolution succeeds but observed a discrepancy. Injected so
   *  this module needs no audit or DB imports. */
  onResolutionWarning?: (registrationId: string, warnings: readonly string[]) => void
  /** Called with the claims behind a successful resolution, so downstream
   *  consumers need not re-derive them from stored tokens. */
  onResolved?: (registrationId: string, accountId: string, claims: Record<string, unknown>) => void
  /**
   * Returns the placeholder address to use for a provider that released none.
   *
   * READ-OR-MINT, not mint: `getUserInfo` runs on every sign-in, so minting
   * here unconditionally would hand a returning person a different address each
   * time. The implementation looks up the account by this identity and reuses
   * the stored address, minting only when there is no account yet. Injected so
   * this module keeps needing no DB import.
   */
  placeholderEmailFor?: (registrationId: string, accountId: string) => Promise<string>
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
  discovery,
  fetchUserInfo,
  onResolutionWarning,
  onResolved,
  placeholderEmailFor,
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
    // A manual endpoint is an explicit choice and the row wins, so discovery
    // never overwrites `userInfoUrl`. Discovery is still fetched when the row
    // has one, because the same document carries `prompt_values_supported`,
    // which has no manual equivalent.
    let userInfoUrl = provider.userInfoUrl || undefined
    let promptValuesSupported: string[] | null = null
    if (discoveryUrl && discovery) {
      const doc = await discovery(discoveryUrl)
      if (!userInfoUrl && typeof doc?.userinfo_endpoint === 'string') {
        userInfoUrl = doc.userinfo_endpoint
      }
      if (Array.isArray(doc?.prompt_values_supported)) {
        promptValuesSupported = doc.prompt_values_supported.filter(
          (v): v is string => typeof v === 'string'
        )
      }
    }

    // One builder, read by production here and by the connection test there.
    const request = authorizeRequestFor(provider)

    // Derived suppression: a provider that publishes its prompt list and omits
    // ours would reject the request outright, so drop it rather than send a
    // parameter we already know will fail. Silence means unknown, not
    // unsupported — almost nobody publishes this — so the default still goes.
    const prompt = supportsPrompt(request.prompt, promptValuesSupported)
      ? request.prompt
      : undefined

    // One resolver for every provider, mapped or not. It is a superset of the
    // library's own behaviour, so withholding it from unmapped providers would
    // leave two resolution paths — the thing this work exists to remove.
    const resolvedUserInfoUrl = userInfoUrl
    const getUserInfo: NonNullable<GenericOAuthConfig['getUserInfo']> = async (tokens) => {
      const result = await resolveIdentity({
        tokens,
        fetchUserInfo: async () =>
          resolvedUserInfoUrl && tokens.accessToken && fetchUserInfo
            ? await fetchUserInfo(resolvedUserInfoUrl, tokens.accessToken)
            : null,
        // Pursue the avatar through the cascade — a `picture` claim commonly
        // lives only at userinfo, past where id + email + name already stopped
        // the fast path. `claims` (merged) then carries it for the after-hook
        // backfill via `onResolved`.
        wantImage: true,
      })
      if (!result.ok) return null
      const { id, email, name, image, emailVerified, claims, warnings } = result.identity
      // Phase one of observe-then-enforce: the discrepancy is recorded, not
      // acted on, so the real rate is known before a release starts refusing
      // sign-ins over it. `onWarning` is injected for the same reason the
      // fetches are — this module stays free of DB and audit imports.
      if (warnings?.length && onResolutionWarning) {
        onResolutionWarning(provider.registrationId, warnings)
      }
      // Hand the freshly-validated claims to role provisioning, which would
      // otherwise re-read the stored ID token — and find nothing for a provider
      // that resolves identity from userinfo or an access token.
      onResolved?.(provider.registrationId, id, claims)

      // Gap-fill runs LAST, after every real source has been tried, so it can
      // never shadow something the provider actually sent.
      //
      // A synthesized name needs no opt-in: it only ever rescues a sign-in that
      // would fail outright, and a display name creates nothing irreversible.
      // A minted address does, so it stays behind `allowMissingEmail`, which is
      // off unless an admin turned it on.
      const resolvedName = name ?? synthesizeName(claims, id)
      let resolvedEmail = email
      if (!resolvedEmail && allowsMissingEmail(provider.claimMapping) && placeholderEmailFor) {
        resolvedEmail = await placeholderEmailFor(provider.registrationId, id)
      }

      // Better-Auth's genericOAuth derives the avatar from `image` only, so
      // hand it the resolved `picture` URL. Better-Auth persists it only when it
      // CREATES the user; an existing account is backfilled by
      // `handleAvatarBackfillAfter` (fill-if-empty, never overwrites).
      const resolvedImage = image ?? pickAvatarUrl(claims)

      // Raw claims first, mapped fields last: the mapped values are the
      // resolved answer and must not be shadowed by a same-named raw claim.
      return {
        ...claims,
        id,
        emailVerified,
        ...(resolvedEmail ? { email: resolvedEmail } : {}),
        ...(resolvedName ? { name: resolvedName } : {}),
        ...(resolvedImage ? { image: resolvedImage } : {}),
      }
    }

    configs.push({
      getUserInfo,
      providerId: provider.registrationId,
      clientId,
      clientSecret: c.clientSecret,
      ...(discoveryUrl ? { discoveryUrl } : {}),
      ...(authorizationUrl ? { authorizationUrl } : {}),
      ...(tokenUrl ? { tokenUrl } : {}),
      ...(userInfoUrl ? { userInfoUrl } : {}),
      scopes: request.scopes,
      // PKCE on every provider. OAuth 2.1 IdPs require code_challenge and
      // reject without it; RFC 7636 §5 makes the params backwards-compatible
      // (IdPs without PKCE support simply ignore them).
      pkce: true,
      ...(prompt ? { prompt } : {}),
      authentication: request.tokenAuth,
      // Better-Auth's JIT block. When false, the OAuth callback aborts in
      // handleOAuthUserInfo before any user/session is created. Existing
      // users still link via accountLinking.trustedProviders.
      disableSignUp: provider.autoCreateUsers === false,
      ...(mapProfileToUser ? { mapProfileToUser } : {}),
      ...(buildLoginHintParams ? { authorizationUrlParams: buildLoginHintParams } : {}),
    })
  }

  return configs
}
