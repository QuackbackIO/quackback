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
import {
  allowsMissingEmail,
  identitySourcesFor,
  profileClaimFor,
} from '@/lib/shared/oidc-claim-mapping'
import { resolveIdentity } from './resolve-identity'
import { synthesizeName } from './placeholder-identity'

// Re-exported so server callers keep this import path. The implementation lives
// in `shared` because the admin editor needs it too.
export { DEFAULT_OIDC_SCOPES, effectiveScopes } from '@/lib/shared/oidc-scopes'

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
  /** Manual-endpoint userinfo URL. */
  userInfoUrl?: string
  /** Custom user-info resolution. Attached to EVERY provider. */
  getUserInfo?: (tokens: {
    idToken?: string
    accessToken?: string
  }) => Promise<ResolvedProfile | null>
  scopes?: string[]
  /** How the client secret reaches the token endpoint. */
  authentication?: 'basic' | 'post'
  mapProfileToUser?: (profile: unknown) => Record<string, unknown>
  // Unset means send no `prompt` parameter (the `omit` choice).
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
   * Injected so this module stays free of fetch imports.
   */
  discovery?: (
    discoveryUrl: string
  ) => Promise<{ userinfo_endpoint?: unknown; prompt_values_supported?: unknown } | null>
  /** Fetches a userinfo document with the bearer token. */
  fetchUserInfo?: (url: string, accessToken: string) => Promise<Record<string, unknown> | null>
  onResolved?: (registrationId: string, accountId: string, claims: Record<string, unknown>) => void
  /**
   * Read-or-mint placeholder address. `getUserInfo` runs on every sign-in, so
   * minting here unconditionally would hand a returning person a different
   * address each time.
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
    // A manual endpoint is an explicit choice and the row wins. Discovery is
    // still fetched when the row has one, because the same document carries
    // `prompt_values_supported`.
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

    const request = authorizeRequestFor(provider)
    // Filter the implicit default against `prompt_values_supported`. An
    // explicit stored prompt is always sent: the admin picked it, and an
    // IdP rejection is visible where a silent omission is not.
    const prompt =
      provider.prompt != null
        ? request.prompt
        : supportsPrompt(request.prompt, promptValuesSupported)
          ? request.prompt
          : undefined

    const rowUserInfoUrl = provider.userInfoUrl || undefined
    const getUserInfo: NonNullable<GenericOAuthConfig['getUserInfo']> = async (tokens) => {
      const mapping = {
        sources: identitySourcesFor(provider.claimMapping),
        idClaim: profileClaimFor(provider.claimMapping, 'id'),
        emailClaim: profileClaimFor(provider.claimMapping, 'email'),
        nameClaim: profileClaimFor(provider.claimMapping, 'name'),
      }
      // Row first, then request-time discovery — never a URL captured at
      // auth-instance build, which can miss userinfo after a discovery outage.
      const resolveUserInfoUrl = async (): Promise<string | undefined> => {
        if (rowUserInfoUrl) return rowUserInfoUrl
        if (!mapping.sources.includes('userinfo')) return undefined
        if (!discoveryUrl || !discovery) return undefined
        const doc = await discovery(discoveryUrl)
        return typeof doc?.userinfo_endpoint === 'string' ? doc.userinfo_endpoint : undefined
      }
      const result = await resolveIdentity({
        tokens,
        fetchUserInfo: async () => {
          const url = await resolveUserInfoUrl()
          return url && tokens.accessToken && fetchUserInfo
            ? await fetchUserInfo(url, tokens.accessToken)
            : null
        },
        mapping,
      })
      if (!result.ok) return null
      const { id, email, name, emailVerified, claims } = result.identity
      onResolved?.(provider.registrationId, id, claims)

      const resolvedName = name ?? synthesizeName(claims, id)
      let resolvedEmail = email
      let minted = false
      if (!resolvedEmail && allowsMissingEmail(provider.claimMapping) && placeholderEmailFor) {
        resolvedEmail = await placeholderEmailFor(provider.registrationId, id)
        minted = true
      }
      const picture = claims.picture
      const image = typeof picture === 'string' && picture.length > 0 ? picture : undefined
      const locale = typeof claims.locale === 'string' && claims.locale.length > 0 ? claims.locale : undefined

      // Only identity columns plus locale (mapProfileToUser reads it). Extra
      // claims stay on the stash — spreading them here would write JWT keys
      // onto the user row (isAnonymous, twoFactorEnabled, …).
      return {
        id,
        emailVerified: minted ? false : emailVerified,
        ...(resolvedEmail ? { email: resolvedEmail } : {}),
        ...(resolvedName ? { name: resolvedName } : {}),
        ...(image ? { image } : {}),
        ...(locale ? { locale } : {}),
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
