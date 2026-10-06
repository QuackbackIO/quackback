/**
 * Identity-provider repository/service.
 *
 * Data-access layer for the `identity_provider` table (the single source
 * of truth for an OIDC IdP) and its linked `sso_verified_domain` rows.
 * Consumed by the auth registration engine, the SSO routing/eligibility
 * code, the server functions, and the admin UI.
 *
 * Cross-pod invalidation: every write that changes what Better-Auth would
 * register (provider rows, their linked domains, or their credentials)
 * bumps `settings.auth_config_version` inside the same transaction, then
 * calls `resetAuth()` + `invalidateSettingsCache()` after commit so other
 * pods rebuild their stale auth instance on their next request. Mirrors
 * the pattern in `settings.service.ts` (verified-domain CRUD).
 */

import type { Role } from '@/lib/shared/roles'
import {
  db,
  account,
  and,
  count,
  eq,
  identityProvider,
  isNull,
  settings,
  ssoVerifiedDomain,
  type IdentityProviderClaimMapping,
} from '@/lib/server/db'
import type { Database, Transaction } from '@/lib/server/db'
import { oidcRedirectStyleFrom, type OidcRedirectStyle } from '@/lib/shared/oidc-redirect'
import type { IdentityProviderId, UserId } from '@quackback/ids'
import { parseSsoTestCapture, type SsoTestCapture } from '@/lib/shared/sso-test-capture'
import {
  applyClaimMappingEdits,
  effectiveProfileSignature,
  mappingSaveRisks,
  mappingWouldStripUnsupported,
  roleRuleRoleIds,
  storedJsonEqual,
  type ClaimMappingOperation,
  type RoleRuleGrantCheck,
} from '@/lib/shared/sso-claim-mapping-edit'
import { logger } from '@/lib/server/logger'
import { getPublicUrlOrNull } from '@/lib/server/storage/s3'
import { absolutizeOffHostAssetUrl } from '@/lib/server/storage/asset-url'
import {
  getPlatformCredentials,
  deletePlatformCredentials,
  getConfiguredIntegrationTypes,
  hasPlatformCredentials,
} from '@/lib/server/domains/platform-credentials/platform-credential.service'
import { AUTH_CREDENTIAL_PREFIX } from '@/lib/server/auth/auth-providers'
import { verifiedDomainCount, shouldRenderPublicButton } from '@/lib/server/auth/provider-ids'
import type { VerifiedDomain } from './settings.types'
import { invalidateSettingsCache, wrapDbError } from './settings.helpers'
import { ConflictError, ForbiddenError, ValidationError } from '@/lib/shared/errors'

const log = logger.child({ component: 'identity-providers' })

// ============================================================================
// Types
// ============================================================================

/**
 * An OIDC identity provider with its linked verified domains and the
 * derived public-surface visibility. Timestamps are ISO-8601 UTC strings
 * (serializable across the server-function boundary), matching the
 * `VerifiedDomain` convention.
 */
export interface IdentityProvider {
  id: IdentityProviderId
  /** Better-Auth providerId — drives the redirect URI + account.provider_id. */
  registrationId: string
  label: string
  /**
   * IdP family from the setup shortcut, used to render the right editor
   * controls and provider label. Null on rows predating the column — the UI
   * falls back to inferring it from `discoveryUrl`.
   */
  kind: 'okta' | 'auth0' | 'keycloak' | 'entra' | 'google' | 'other' | null
  discoveryUrl: string | null
  authorizationUrl: string | null
  tokenUrl: string | null
  userInfoUrl: string | null
  /** JWKS endpoint + expected issuer for manual-endpoint installs (no discovery
   *  doc), so the SSO test can verify the ID token. Null for discovery providers. */
  jwksUri: string | null
  issuer: string | null
  clientId: string
  scopes: string | null
  prompt: string | null
  tokenEndpointAuthMethod: string | null
  idTokenNonce: string | null
  enabled: boolean
  /** True when a client secret is saved at `auth_<registrationId>`. An enabled
   *  provider without one registers nothing, so it is not a usable sign-in
   *  method — the "keep one method enabled" guard treats it as not counting. */
  configured: boolean
  autoCreateUsers: boolean
  autoProvisionRole: Role | null
  claimMapping: IdentityProviderClaimMapping | null
  /** Which callback URL sign-in sends as the redirect URI. `current` unless
   *  the provider was recorded as `legacy`; see `oidc-redirect.ts`. */
  redirectStyle: OidcRedirectStyle
  showButton: boolean
  /** S3 storage key for the uploaded provider logo, or null. */
  logoKey: string | null
  /** Public URL for {@link logoKey}, absolutised for off-host rendering. Null
   *  when no logo is set — the UI then falls back to the brand glyph. */
  logoUrl: string | null
  /** ISO-8601 UTC; null until a redirect-affecting detail changes. */
  detailsChangedAt: string | null
  /** ISO-8601 UTC; null until a test sign-in succeeds. */
  lastSuccessfulTestAt: string | null
  /** Last usable Test fixture, including mapping failures. Null until a test. */
  lastTestCapture: SsoTestCapture | null
  createdAt: string
  domains: VerifiedDomain[]
  /** `routed` iff ≥1 linked domain is verified; otherwise `button`. */
  visibility: 'button' | 'routed'
}

/**
 * Full desired state of a provider. Required fields define the IdP's
 * identity; the rest are optional. On INSERT, omitted optionals fall back
 * to their column defaults; on UPDATE, omitted optionals are left
 * untouched (patch semantics), so a partial save never clobbers an
 * unrelated column.
 */
export interface UpsertIdentityProviderInput {
  /** Update target when editing an existing provider; falls back to `registrationId`. */
  id?: IdentityProviderId
  registrationId: string
  label: string
  kind?: 'okta' | 'auth0' | 'keycloak' | 'entra' | 'google' | 'other' | null
  clientId: string
  discoveryUrl?: string | null
  authorizationUrl?: string | null
  tokenUrl?: string | null
  userInfoUrl?: string | null
  jwksUri?: string | null
  issuer?: string | null
  scopes?: string | null
  prompt?: string | null
  tokenEndpointAuthMethod?: string | null
  idTokenNonce?: string | null
  enabled?: boolean
  autoCreateUsers?: boolean
  autoProvisionRole?: Role | null
  claimMapping?: IdentityProviderClaimMapping | null
  showButton?: boolean
  acknowledgeIdentifierChange?: boolean
  acknowledgeAdminRules?: boolean
  /**
   * The grant check for the saving admin (`roleRuleGrantCheck` in the roles
   * domain). Saving a rule that grants a workspace role is a grant, so such a
   * save without one is refused.
   */
  checkRoleGrants?: RoleRuleGrantCheck
}

// ============================================================================
// Pure predicates (no DB) — THE canonical visibility logic.
// Routing, the admin badge, the public-button list, AND the portal-eligibility
// gate (`isSsoBlockedForRole`) all use these. `verifiedDomainCount` and
// `shouldRenderPublicButton` live in `auth/provider-ids.ts` (DB-free) so the
// enforcement gate can share them without importing this service; re-exported
// here so existing settings/UI consumers keep their import path.
// ============================================================================

export { verifiedDomainCount, shouldRenderPublicButton }

/**
 * `routed` when at least one linked domain is verified (emails at that
 * domain are steered to this provider by default); `button` otherwise
 * (the provider only appears as a generic sign-in button).
 */
export function deriveVisibility(p: {
  domains: { verifiedAt: string | null }[]
}): 'button' | 'routed' {
  return verifiedDomainCount(p) > 0 ? 'routed' : 'button'
}

/** Fields whose change invalidates a prior successful connection test. */
const CONNECTION_FIELDS = [
  'clientId',
  'discoveryUrl',
  'authorizationUrl',
  'tokenUrl',
  'userInfoUrl',
  'jwksUri',
  'issuer',
  // Scopes decide which claims the IdP releases, which is precisely what the
  // test validates. Omitting them let a stale pass keep vouching for a scope
  // set the test never exercised. Prompt and the token-endpoint auth method are
  // here for the same reason: both can make a request the IdP refuses. The
  // nonce setting decides whether the test checks the echo at all.
  'scopes',
  'prompt',
  'tokenEndpointAuthMethod',
  'idTokenNonce',
] as const

type ConnectionField = (typeof CONNECTION_FIELDS)[number]

/**
 * True when an upsert changes anything the connection test depends on, so
 * `detailsChangedAt` must be restamped and a prior `lastSuccessfulTestAt`
 * stops counting (`isSsoTestValid` compares the two).
 *
 * Honours patch semantics: a field the caller did not supply is not a change,
 * so editing an unrelated field (a label, say) never invalidates a good test.
 * Pure and exported so the rule is unit-testable without a transaction.
 */
export function connectionAffectingChange(
  input: Partial<Pick<UpsertIdentityProviderInput, ConnectionField | 'claimMapping'>>,
  existing: Pick<IdentityProvider, ConnectionField> & {
    claimMapping?: IdentityProvider['claimMapping']
  }
): boolean {
  if (CONNECTION_FIELDS.some((f) => input[f] !== undefined && input[f] !== existing[f])) {
    return true
  }
  // Role and attribute mapping edits must not invalidate a passing test — they
  // do not change the request the IdP sees. Profile (sources, claim paths,
  // missing-email) does, so a prior stamp cannot vouch for it.
  if (input.claimMapping === undefined) return false
  return (
    effectiveProfileSignature(input.claimMapping) !==
    effectiveProfileSignature(existing.claimMapping)
  )
}

// ============================================================================
// Row mappers
// ============================================================================

/** S3 key → public URL, absolutised so an off-host portal can render it. Mirrors
 *  the helper of the same name in `settings.service.ts`. */
function offHostPublicUrl(key: string | null | undefined): string | null {
  const stored = getPublicUrlOrNull(key)
  return stored ? absolutizeOffHostAssetUrl(stored) : stored
}

function rowToVerifiedDomain(row: typeof ssoVerifiedDomain.$inferSelect): VerifiedDomain {
  return {
    id: row.id,
    name: row.name,
    verificationToken: row.verificationToken,
    verifiedAt: row.verifiedAt ? row.verifiedAt.toISOString() : null,
    enforced: row.enforced,
    providerId: row.providerId,
    createdAt: row.createdAt.toISOString(),
  }
}

/**
 * The recorded redirect styles, keyed by registrationId, from the raw
 * `settings.auth_config` JSON. Read directly rather than through the settings
 * cache so a write in the same request is seen.
 */
async function readRedirectStyles(
  exec: Database | Transaction
): Promise<Record<string, OidcRedirectStyle>> {
  const [row] = await exec.select({ authConfig: settings.authConfig }).from(settings).limit(1)
  return parseRedirectStyles(parseAuthConfigJson(row?.authConfig ?? null))
}

/**
 * The same styles from the workspace settings row every request already reads
 * (memoized per request and cached across them), so listing providers costs no
 * extra query. A caller that already holds the row passes its `auth_config`,
 * which the workspace-settings loader must do: it lists providers while that
 * very memo is being filled, and waiting on it from inside would never return.
 * Writes read through {@link readRedirectStyles} instead, after their commit.
 */
async function readCachedRedirectStyles(opts: {
  authConfig?: string | null
}): Promise<Record<string, OidcRedirectStyle>> {
  let authConfig = opts.authConfig ?? null
  if (!('authConfig' in opts)) {
    const { getWorkspaceSettingsRow } = await import('./settings.service')
    authConfig = (await getWorkspaceSettingsRow())?.authConfig ?? null
  }
  return parseRedirectStyles(parseAuthConfigJson(authConfig))
}

function parseAuthConfigJson(json: string | null): Record<string, unknown> {
  if (!json) return {}
  try {
    const parsed: unknown = JSON.parse(json)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

function parseRedirectStyles(
  authConfig: Record<string, unknown>
): Record<string, OidcRedirectStyle> {
  const raw = authConfig.oidcRedirectStyles
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const styles: Record<string, OidcRedirectStyle> = {}
  for (const [registrationId, value] of Object.entries(raw)) {
    styles[registrationId] = oidcRedirectStyleFrom(value)
  }
  return styles
}

/**
 * Record (or with `null`, forget) a provider's redirect style, inside the
 * caller's transaction when it passes one. Rewrites only the
 * `oidcRedirectStyles` key of the stored JSON and leaves every other key
 * exactly as stored, reading under `FOR UPDATE`. The other `auth_config`
 * writers (`updateAuthConfig`, `patchSsoOidc`) take the same row lock and keep
 * `oidcRedirectStyles` as the locked row has it, so neither side can write a
 * stale copy of the other's keys back. A caller holding a provider row must
 * have locked it before calling this. A workspace with no settings row has
 * nothing to record against and is left alone.
 */
export async function writeRedirectStyle(
  tx: Database | Transaction,
  registrationId: string,
  style: OidcRedirectStyle | null
): Promise<void> {
  const [row] = await tx
    .select({ id: settings.id, authConfig: settings.authConfig })
    .from(settings)
    .limit(1)
    .for('update')
  if (!row) return
  const stored = parseAuthConfigJson(row.authConfig)
  const styles = parseRedirectStyles(stored)
  if (style) {
    styles[registrationId] = style
  } else {
    delete styles[registrationId]
  }
  await tx
    .update(settings)
    .set({ authConfig: JSON.stringify({ ...stored, oidcRedirectStyles: styles }) })
    .where(eq(settings.id, row.id))
}

function rowToIdentityProvider(
  row: typeof identityProvider.$inferSelect,
  domains: VerifiedDomain[],
  configured: boolean,
  redirectStyles: Record<string, OidcRedirectStyle>
): IdentityProvider {
  return {
    id: row.id,
    registrationId: row.registrationId,
    label: row.label,
    kind: row.kind,
    discoveryUrl: row.discoveryUrl,
    authorizationUrl: row.authorizationUrl,
    tokenUrl: row.tokenUrl,
    userInfoUrl: row.userInfoUrl,
    jwksUri: row.jwksUri,
    issuer: row.issuer,
    clientId: row.clientId,
    scopes: row.scopes,
    prompt: row.prompt,
    tokenEndpointAuthMethod: row.tokenEndpointAuthMethod,
    idTokenNonce: row.idTokenNonce,
    enabled: row.enabled,
    configured,
    autoCreateUsers: row.autoCreateUsers,
    autoProvisionRole: row.autoProvisionRole,
    claimMapping: row.claimMapping ?? null,
    redirectStyle: oidcRedirectStyleFrom(redirectStyles[row.registrationId]),
    showButton: row.showButton,
    logoKey: row.logoKey,
    logoUrl: offHostPublicUrl(row.logoKey),
    detailsChangedAt: row.detailsChangedAt ? row.detailsChangedAt.toISOString() : null,
    lastSuccessfulTestAt: row.lastSuccessfulTestAt ? row.lastSuccessfulTestAt.toISOString() : null,
    lastTestCapture: parseSsoTestCapture(row.lastTestCapture),
    createdAt: row.createdAt.toISOString(),
    domains,
    visibility: deriveVisibility({ domains }),
  }
}

// ============================================================================
// Reads
// ============================================================================

/**
 * List every identity provider with its linked verified domains and the
 * derived visibility. Domains are grouped from `sso_verified_domain` by
 * `provider_id`; unlinked domains (null `provider_id`) are excluded.
 *
 * `opts.authConfig` is the raw `settings.auth_config` the caller already holds
 * (null for none); omitted, it comes from the request's cached settings row.
 */
export async function listIdentityProviders(
  opts: { authConfig?: string | null } = {}
): Promise<IdentityProvider[]> {
  try {
    const [providers, domains, configuredTypes, redirectStyles] = await Promise.all([
      db.select().from(identityProvider).orderBy(identityProvider.createdAt),
      db.select().from(ssoVerifiedDomain).orderBy(ssoVerifiedDomain.createdAt),
      getConfiguredIntegrationTypes(),
      readCachedRedirectStyles(opts),
    ])

    const byProvider = new Map<string, VerifiedDomain[]>()
    for (const row of domains) {
      if (!row.providerId) continue
      const list = byProvider.get(row.providerId)
      if (list) {
        list.push(rowToVerifiedDomain(row))
      } else {
        byProvider.set(row.providerId, [rowToVerifiedDomain(row)])
      }
    }

    return providers.map((p) =>
      rowToIdentityProvider(
        p,
        byProvider.get(p.id) ?? [],
        configuredTypes.has(`${AUTH_CREDENTIAL_PREFIX}${p.registrationId}`),
        redirectStyles
      )
    )
  } catch (error) {
    log.error({ err: error }, 'list identity providers failed')
    wrapDbError('list identity providers', error)
  }
}

/**
 * Decrypted OIDC credentials for a provider, read from
 * `platform_credentials` at key `auth_<registrationId>`. Returns null when
 * no credential row exists. `getPlatformCredentials` already decrypts via
 * the DB credential source, so the blob is plaintext here — the IdP-owned
 * client secret should never leave the auth runtime path.
 *
 * For backfilled `auth_sso` rows the blob historically holds only the
 * client secret; `clientId` / `discoveryUrl` live on the provider columns.
 * Callers that need a definitive `clientId` / `discoveryUrl` should prefer
 * the `identity_provider` columns and use this only for `clientSecret`.
 */
export async function getIdentityProviderCredentials(
  registrationId: string
): Promise<{ clientId: string; clientSecret: string; discoveryUrl: string } | null> {
  try {
    const creds = await getPlatformCredentials(`${AUTH_CREDENTIAL_PREFIX}${registrationId}`)
    if (!creds) return null
    return {
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      discoveryUrl: creds.discoveryUrl,
    }
  } catch (error) {
    log.error({ err: error }, 'get identity provider credentials failed')
    wrapDbError('get identity provider credentials', error)
  }
}

// ============================================================================
// Writes (each bumps auth_config_version in-tx + resets/invalidates after)
// ============================================================================

async function listDomainsForProvider(providerId: IdentityProviderId): Promise<VerifiedDomain[]> {
  const rows = await db
    .select()
    .from(ssoVerifiedDomain)
    .where(eq(ssoVerifiedDomain.providerId, providerId))
    .orderBy(ssoVerifiedDomain.createdAt)
  return rows.map(rowToVerifiedDomain)
}

/**
 * Insert a new provider or update an existing one (matched by `id`, else
 * by `registrationId`). The provider config feeds Better-Auth registration
 * directly, so the write bumps `auth_config_version` in-tx and resets the
 * local auth instance after commit.
 */
export async function upsertIdentityProvider(
  input: UpsertIdentityProviderInput
): Promise<IdentityProvider> {
  log.info({ registrationId: input.registrationId }, 'upsert identity provider')
  try {
    const { ValidationError } = await import('@/lib/shared/errors')
    // SSRF guard: validate every connection URL before any DB write. The auth
    // runtime and SSO test callback fetch discoveryUrl / tokenUrl / userInfoUrl
    // server-side, and authorizationUrl is the redirect target — none may
    // resolve to a private or loopback address. Manual endpoints get the same
    // guard as discoveryUrl so a discovery-less config can't smuggle one in.
    const guardedUrls: ReadonlyArray<readonly [string, string | null | undefined]> = [
      ['Discovery URL', input.discoveryUrl],
      ['Authorization URL', input.authorizationUrl],
      ['Token URL', input.tokenUrl],
      ['User info URL', input.userInfoUrl],
      ['JWKS URI', input.jwksUri],
    ]
    if (guardedUrls.some(([, value]) => value)) {
      const { checkUrlSafety } = await import('@/lib/server/content/ssrf-guard')
      for (const [label, value] of guardedUrls) {
        if (!value) continue
        const safety = await checkUrlSafety(value)
        if (!safety.safe) {
          throw new ValidationError(
            'INVALID_IDP_CONFIG',
            safety.reason === 'ssrf-rejected'
              ? `${label} must point to a public IdP, not a private or loopback address.`
              : `${label} is not a valid https:// URL.`
          )
        }
      }
    }

    const { bumpAuthConfigVersionInTx } = await import('@/lib/server/auth/config-version')
    const { resetAuth } = await import('@/lib/server/auth')

    const saved = await db.transaction(async (tx) => {
      const [existing] = input.id
        ? await tx.select().from(identityProvider).where(eq(identityProvider.id, input.id))
        : await tx
            .select()
            .from(identityProvider)
            .where(eq(identityProvider.registrationId, input.registrationId))

      // An enabled provider must have a usable OAuth endpoint source, or
      // buildGenericOAuthConfigs registers a config with nowhere to send users
      // (a sole-IdP workspace would then route the login button into a broken
      // flow). Require a discovery URL, or both a manual authorization + token
      // URL. Patch semantics: fall back to the stored row for fields the caller
      // didn't supply.
      const willBeEnabled =
        input.enabled !== undefined ? input.enabled : (existing?.enabled ?? false)
      if (willBeEnabled) {
        const effectiveDiscovery =
          input.discoveryUrl !== undefined ? input.discoveryUrl : (existing?.discoveryUrl ?? null)
        const effectiveAuthz =
          input.authorizationUrl !== undefined
            ? input.authorizationUrl
            : (existing?.authorizationUrl ?? null)
        const effectiveToken =
          input.tokenUrl !== undefined ? input.tokenUrl : (existing?.tokenUrl ?? null)
        if (!effectiveDiscovery && !(effectiveAuthz && effectiveToken)) {
          throw new ValidationError(
            'INVALID_IDP_CONFIG',
            'An enabled provider needs a Discovery URL, or both an Authorization URL and a Token URL.'
          )
        }
      }

      let row: typeof identityProvider.$inferSelect
      if (existing) {
        // Patch semantics: only overwrite columns the caller supplied.
        // registrationId is immutable on update — it keys the Better-Auth
        // provider id, the redirect URI, account.provider_id, and the
        // `auth_<id>` credential. Rewriting it would orphan all of those (and
        // slip past the enabled-based last-method guard), so keep the stored id
        // regardless of what the caller passed.
        const patch: Partial<typeof identityProvider.$inferInsert> = {
          registrationId: existing.registrationId,
          label: input.label,
          clientId: input.clientId,
        }
        if (input.kind !== undefined) patch.kind = input.kind
        if (input.discoveryUrl !== undefined) patch.discoveryUrl = input.discoveryUrl
        if (input.authorizationUrl !== undefined) patch.authorizationUrl = input.authorizationUrl
        if (input.tokenUrl !== undefined) patch.tokenUrl = input.tokenUrl
        if (input.userInfoUrl !== undefined) patch.userInfoUrl = input.userInfoUrl
        if (input.jwksUri !== undefined) patch.jwksUri = input.jwksUri
        if (input.issuer !== undefined) patch.issuer = input.issuer
        if (input.scopes !== undefined) patch.scopes = input.scopes
        if (input.prompt !== undefined) patch.prompt = input.prompt
        if (input.tokenEndpointAuthMethod !== undefined)
          patch.tokenEndpointAuthMethod = input.tokenEndpointAuthMethod
        if (input.idTokenNonce !== undefined) patch.idTokenNonce = input.idTokenNonce
        if (input.enabled !== undefined) patch.enabled = input.enabled
        if (input.autoCreateUsers !== undefined) patch.autoCreateUsers = input.autoCreateUsers
        if (input.autoProvisionRole !== undefined) patch.autoProvisionRole = input.autoProvisionRole
        if (input.claimMapping !== undefined) {
          if (mappingWouldStripUnsupported(existing.claimMapping, input.claimMapping)) {
            throw new ValidationError(
              'MAPPING_UNSUPPORTED_STRIPPED',
              'This save would drop unsupported mapping data. Reload and use the mapping editor.'
            )
          }
          if (!storedJsonEqual(existing.claimMapping, input.claimMapping)) {
            const grants = await runRoleGrantCheck(
              existing.claimMapping,
              input.claimMapping,
              input.checkRoleGrants
            )
            const risks = mappingSaveRisks(existing.claimMapping, input.claimMapping, grants)
            if (risks.identifierChanged && !input.acknowledgeIdentifierChange) {
              throw new ValidationError(
                'MAPPING_IDENTIFIER_ACK_REQUIRED',
                'Changing the identifier requires explicit acknowledgement.'
              )
            }
            if (risks.hasAdminRules && !input.acknowledgeAdminRules) {
              throw new ValidationError(
                'MAPPING_ADMIN_ACK_REQUIRED',
                'Saving admin role rules requires explicit acknowledgement.'
              )
            }
          }
          patch.claimMapping = input.claimMapping
        }
        if (input.showButton !== undefined) patch.showButton = input.showButton

        // Restamp the freshness baseline when a connection-affecting field
        // changes — clientId or ANY fetched endpoint (discovery + the manual
        // authorization/token/userinfo URLs). The gate `isSsoTestValid`
        // compares `lastSuccessfulTestAt` vs `detailsChangedAt`; without this
        // stamp a pre-edit test could vouch for a swapped token endpoint.
        if (connectionAffectingChange(input, existing)) {
          patch.detailsChangedAt = new Date()
        }

        ;[row] = await tx
          .update(identityProvider)
          .set(patch)
          .where(eq(identityProvider.id, existing.id))
          .returning()
      } else {
        if (input.claimMapping) {
          await runRoleGrantCheck(null, input.claimMapping, input.checkRoleGrants)
        }
        // Insert: omit `id` so the typeIdWithDefault column generates it.
        ;[row] = await tx
          .insert(identityProvider)
          .values({
            registrationId: input.registrationId,
            label: input.label,
            kind: input.kind ?? null,
            clientId: input.clientId,
            discoveryUrl: input.discoveryUrl ?? null,
            authorizationUrl: input.authorizationUrl ?? null,
            tokenUrl: input.tokenUrl ?? null,
            userInfoUrl: input.userInfoUrl ?? null,
            jwksUri: input.jwksUri ?? null,
            issuer: input.issuer ?? null,
            scopes: input.scopes ?? null,
            prompt: input.prompt ?? null,
            tokenEndpointAuthMethod: input.tokenEndpointAuthMethod ?? null,
            idTokenNonce: input.idTokenNonce ?? null,
            enabled: input.enabled ?? false,
            autoCreateUsers: input.autoCreateUsers ?? true,
            autoProvisionRole: input.autoProvisionRole ?? null,
            claimMapping: input.claimMapping ?? null,
            showButton: input.showButton ?? false,
          })
          .returning()
      }
      await bumpAuthConfigVersionInTx(tx)
      return row
    })

    resetAuth()
    await invalidateSettingsCache()

    const [domains, configured, redirectStyles] = await Promise.all([
      listDomainsForProvider(saved.id),
      hasPlatformCredentials(`${AUTH_CREDENTIAL_PREFIX}${saved.registrationId}`),
      readRedirectStyles(db),
    ])
    return rowToIdentityProvider(saved, domains, configured, redirectStyles)
  } catch (error) {
    log.error({ err: error }, 'upsert identity provider failed')
    wrapDbError('upsert identity provider', error)
  }
}

/**
 * Delete a provider by id. Linked `sso_verified_domain` rows cascade via
 * the FK, but the credential row has no FK to cascade — it is deleted
 * explicitly via `deletePlatformCredentials` (which itself bumps the
 * version + resets auth + drops the configured-types cache). No-op when
 * the provider doesn't exist.
 */
export async function deleteIdentityProvider(id: IdentityProviderId): Promise<void> {
  log.info({ id }, 'delete identity provider')
  try {
    const { bumpAuthConfigVersionInTx } = await import('@/lib/server/auth/config-version')

    const deleted = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ registrationId: identityProvider.registrationId })
        .from(identityProvider)
        .where(eq(identityProvider.id, id))
      if (!existing) return null

      // Refuse while identities still reference it. Deletion removes the row
      // and its credential but leaves `account` rows carrying the old
      // registrationId, and registrationId is immutable on update — so
      // delete-and-recreate is the natural admin move for changing one, and it
      // silently orphans every identity. A real-email provider papers over it
      // by re-linking on address match; a placeholder-address provider has no
      // shared key at all, so its people come back as brand-new accounts and
      // lose their votes, roles and conversations with no way back.
      const [{ n }] = await tx
        .select({ n: count() })
        .from(account)
        .where(eq(account.providerId, existing.registrationId))
      if (n > 0) {
        throw new ValidationError(
          'PROVIDER_HAS_ACCOUNTS',
          `${n} ${n === 1 ? 'person signs' : 'people sign'} in through this provider. Removing it would orphan ${n === 1 ? 'their account' : 'their accounts'}. Disable it instead, or remove those accounts first.`
        )
      }

      const [row] = await tx
        .delete(identityProvider)
        .where(eq(identityProvider.id, id))
        .returning({ registrationId: identityProvider.registrationId })
      if (!row) return null
      await writeRedirectStyle(tx, row.registrationId, null)
      await bumpAuthConfigVersionInTx(tx)
      return row
    })

    if (!deleted) return

    // Explicit credential cleanup — no FK cascade. This call also performs
    // the trailing resetAuth() + cache invalidation for the whole delete.
    await deletePlatformCredentials(`${AUTH_CREDENTIAL_PREFIX}${deleted.registrationId}`)
  } catch (error) {
    // A refusal is a decision, not a database fault — let it through intact so
    // the admin sees why rather than a generic write error.
    if (error instanceof ValidationError) throw error
    log.error({ err: error }, 'delete identity provider failed')
    wrapDbError('delete identity provider', error)
  }
}

/**
 * Switch which callback URL a provider sends as its redirect URI. Sign-in
 * reads it at registration, so the write bumps the auth config version. It
 * also restamps `detailsChangedAt`: a test made through the old URL says
 * nothing about whether the IdP accepts the new one. Returns the updated
 * provider, or null when it does not exist.
 */
export async function setIdentityProviderRedirectStyle(
  id: IdentityProviderId,
  style: OidcRedirectStyle
): Promise<IdentityProvider | null> {
  log.info({ id, style }, 'set identity provider redirect style')
  try {
    const { bumpAuthConfigVersionInTx } = await import('@/lib/server/auth/config-version')
    const { resetAuth } = await import('@/lib/server/auth')

    const saved = await db.transaction(async (tx) => {
      // Lock the provider row FIRST, then settings (inside writeRedirectStyle):
      // the order upsert and delete take them in, which write the provider row
      // and then bump the version on settings. The opposite order would let a
      // switch and a save of the same provider each hold the lock the other
      // waits for.
      const [existing] = await tx
        .select({ registrationId: identityProvider.registrationId })
        .from(identityProvider)
        .where(eq(identityProvider.id, id))
        .for('update')
      if (!existing) return null
      const current = oidcRedirectStyleFrom((await readRedirectStyles(tx))[existing.registrationId])
      if (current === style) {
        const [row] = await tx.select().from(identityProvider).where(eq(identityProvider.id, id))
        return row ?? null
      }
      await writeRedirectStyle(tx, existing.registrationId, style)
      const [row] = await tx
        .update(identityProvider)
        .set({ detailsChangedAt: new Date() })
        .where(eq(identityProvider.id, id))
        .returning()
      await bumpAuthConfigVersionInTx(tx)
      return row ?? null
    })
    if (!saved) return null

    resetAuth()
    await invalidateSettingsCache()
    const [domains, configured, redirectStyles] = await Promise.all([
      listDomainsForProvider(saved.id),
      hasPlatformCredentials(`${AUTH_CREDENTIAL_PREFIX}${saved.registrationId}`),
      readRedirectStyles(db),
    ])
    return rowToIdentityProvider(saved, domains, configured, redirectStyles)
  } catch (error) {
    log.error({ err: error }, 'set identity provider redirect style failed')
    wrapDbError('set identity provider redirect style', error)
  }
}

/**
 * Stamp a freshness timestamp to `now()`, bump the version, and reset auth.
 * Generalized from the SSO gates: `detailsChangedAt` is the baseline a
 * later test sign-in must postdate to "vouch" for the current config, and
 * `lastSuccessfulTestAt` records that proof. Both can flip whether the
 * provider is eligible to register, so the write bumps the version like any
 * other registration-affecting change. No-op when the provider is gone.
 */
async function stampTimestamp(
  id: IdentityProviderId,
  set: { detailsChangedAt: Date } | { lastSuccessfulTestAt: Date; lastTestCapture?: SsoTestCapture }
): Promise<void> {
  const { bumpAuthConfigVersionInTx } = await import('@/lib/server/auth/config-version')
  const { resetAuth } = await import('@/lib/server/auth')

  const stamped = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(identityProvider)
      .set(set)
      .where(eq(identityProvider.id, id))
      .returning({ id: identityProvider.id })
    if (!row) return false
    await bumpAuthConfigVersionInTx(tx)
    return true
  })

  if (stamped) {
    resetAuth()
    await invalidateSettingsCache()
  }
}

/** Stamp `details_changed_at = now()` — the freshness baseline. */
export async function stampDetailsChanged(id: IdentityProviderId): Promise<void> {
  log.info({ id }, 'stamp identity provider details changed')
  try {
    await stampTimestamp(id, { detailsChangedAt: new Date() })
  } catch (error) {
    log.error({ err: error }, 'stamp identity provider details changed failed')
    wrapDbError('stamp identity provider details changed', error)
  }
}

/**
 * Persist a test capture against the configuration the test started with.
 * Success stamps `lastSuccessfulTestAt`; mapping failure replaces diagnostic
 * capture only. A zero-row conditional update is stale, not success.
 */
export async function persistTestResult(
  id: IdentityProviderId,
  args: {
    expectedDetailsChangedAt: string | null
    outcome: 'success' | 'mapping_failed'
    capture: SsoTestCapture
    /** What the test saw of the nonce. Written only with a passing result, and
     *  without restamping `detailsChangedAt`, which would void this very pass. */
    idTokenNonce?: 'check' | 'off'
    /** The admin who ran the test; a nonce change it makes is audited as theirs. */
    auditActorUserId?: UserId
  }
): Promise<'stamped' | 'stale'> {
  const { bumpAuthConfigVersionInTx } = await import('@/lib/server/auth/config-version')
  const { resetAuth } = await import('@/lib/server/auth')

  log.info({ id, outcome: args.outcome }, 'persist identity provider test result')
  try {
    const detailsMatch =
      args.expectedDetailsChangedAt === null
        ? isNull(identityProvider.detailsChangedAt)
        : eq(identityProvider.detailsChangedAt, new Date(args.expectedDetailsChangedAt))

    const writesNonce = args.outcome === 'success' && args.idTokenNonce !== undefined
    const nextNonce = args.idTokenNonce === 'off' ? 'off' : null

    const result = await db.transaction(async (tx) => {
      // Read under the row lock the update takes anyway, so the audited
      // "before" is the value this write replaces even when tests overlap.
      const [prior] = writesNonce
        ? await tx
            .select({ idTokenNonce: identityProvider.idTokenNonce })
            .from(identityProvider)
            .where(eq(identityProvider.id, id))
            .for('update')
        : []
      const [row] = await tx
        .update(identityProvider)
        .set({
          lastTestCapture: args.capture,
          ...(args.outcome === 'success' ? { lastSuccessfulTestAt: new Date() } : {}),
          ...(writesNonce ? { idTokenNonce: nextNonce } : {}),
        })
        .where(and(eq(identityProvider.id, id), detailsMatch))
        .returning({ id: identityProvider.id })
      if (!row) return 'stale' as const
      if (args.outcome === 'success') {
        await bumpAuthConfigVersionInTx(tx)
      }
      if (writesNonce && prior && (prior.idTokenNonce ?? null) !== nextNonce) {
        const { recordAuditEventInTransaction } = await import('@/lib/server/audit/log')
        await recordAuditEventInTransaction(tx, {
          event: 'idp.updated',
          actor: { userId: args.auditActorUserId ?? null },
          target: { type: 'identity_provider', id },
          before: { idTokenNonce: prior.idTokenNonce ?? null },
          after: { idTokenNonce: nextNonce },
          metadata: { source: 'connection_test' },
        })
      }
      return 'stamped' as const
    })

    if (result === 'stamped') {
      if (args.outcome === 'success') resetAuth()
      await invalidateSettingsCache()
    }
    return result
  } catch (error) {
    log.error({ err: error }, 'persist identity provider test result failed')
    wrapDbError('persist identity provider test result', error)
    throw error
  }
}

/**
 * Run the caller's grant check over a mapping save. Without one, a save that
 * grants a workspace role is refused (fail closed) and no role counts as
 * admin-tier, which only matters for rules that were already stored.
 */
async function runRoleGrantCheck(
  before: unknown,
  after: unknown,
  check: RoleRuleGrantCheck | undefined
): Promise<{ adminTierRoleIds: ReadonlySet<string> }> {
  if (check) return check(before, after)
  if (roleRuleRoleIds(after, { newSince: before }).length > 0) {
    throw new ForbiddenError('GRANT_CEILING', 'Assigner permission set is required')
  }
  return { adminTierRoleIds: new Set() }
}

export async function saveIdentityProviderClaimMapping(
  id: IdentityProviderId,
  args: {
    expectedClaimMapping: unknown
    operations: ClaimMappingOperation[]
    acknowledgeIdentifierChange?: boolean
    acknowledgeAdminRules?: boolean
    /** The saving admin's grant check; see `UpsertIdentityProviderInput`. */
    checkRoleGrants?: RoleRuleGrantCheck
  }
): Promise<IdentityProvider> {
  const { bumpAuthConfigVersionInTx } = await import('@/lib/server/auth/config-version')
  const { resetAuth } = await import('@/lib/server/auth')

  log.info({ id }, 'save identity provider claim mapping')
  try {
    const saved = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(identityProvider)
        .where(eq(identityProvider.id, id))
        .for('update')
      if (!existing) {
        throw new ValidationError('IDP_NOT_FOUND', 'Identity provider not found.')
      }
      if (!storedJsonEqual(existing.claimMapping ?? null, args.expectedClaimMapping ?? null)) {
        throw new ConflictError(
          'MAPPING_CONFLICT',
          'This mapping was updated elsewhere. Reload and try again.'
        )
      }
      const next = applyClaimMappingEdits(existing.claimMapping, args.operations)
      const grants = await runRoleGrantCheck(existing.claimMapping, next, args.checkRoleGrants)
      const risks = mappingSaveRisks(existing.claimMapping, next, grants)
      if (risks.identifierChanged && !args.acknowledgeIdentifierChange) {
        throw new ValidationError(
          'MAPPING_IDENTIFIER_ACK_REQUIRED',
          'Changing the identifier requires explicit acknowledgement.'
        )
      }
      if (risks.hasAdminRules && args.operations.length > 0 && !args.acknowledgeAdminRules) {
        throw new ValidationError(
          'MAPPING_ADMIN_ACK_REQUIRED',
          'Saving admin role rules requires explicit acknowledgement.'
        )
      }
      const restamp =
        effectiveProfileSignature(existing.claimMapping) !== effectiveProfileSignature(next)
      const [row] = await tx
        .update(identityProvider)
        .set({
          claimMapping: next as IdentityProviderClaimMapping | null,
          ...(restamp ? { detailsChangedAt: new Date() } : {}),
        })
        .where(eq(identityProvider.id, id))
        .returning()
      await bumpAuthConfigVersionInTx(tx)
      return row
    })

    resetAuth()
    await invalidateSettingsCache()
    const [domains, configured, redirectStyles] = await Promise.all([
      listDomainsForProvider(saved.id),
      hasPlatformCredentials(`${AUTH_CREDENTIAL_PREFIX}${saved.registrationId}`),
      readRedirectStyles(db),
    ])
    return rowToIdentityProvider(saved, domains, configured, redirectStyles)
  } catch (error) {
    if (
      error instanceof ValidationError ||
      error instanceof ConflictError ||
      error instanceof ForbiddenError
    ) {
      throw error
    }
    log.error({ err: error }, 'save identity provider claim mapping failed')
    wrapDbError('save identity provider claim mapping', error)
    throw error
  }
}

// The provider-logo write path lives in `identity-provider-logo.service.ts`,
// mirroring how `settings.media.ts` sits beside `settings.service.ts` — the
// logo only feeds the rendered sign-in button and is managed on its own so an
// image upload never rides along with a connection edit.
