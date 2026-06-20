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
      scopes: provider.scopes ? provider.scopes.split(/\s+/).filter(Boolean) : ['openid', 'email', 'profile'],
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
      ...(mapProfileToUser ? { mapProfileToUser } : {}),
      ...(buildLoginHintParams ? { authorizationUrlParams: buildLoginHintParams } : {}),
    })
  }

  return configs
}
