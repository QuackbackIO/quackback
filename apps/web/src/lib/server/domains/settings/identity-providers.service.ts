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

import {
  db,
  eq,
  identityProvider,
  ssoVerifiedDomain,
  type IdentityProviderAttributeMapping,
} from '@/lib/server/db'
import type { IdentityProviderId } from '@quackback/ids'
import { logger } from '@/lib/server/logger'
import {
  getPlatformCredentials,
  deletePlatformCredentials,
} from '@/lib/server/domains/platform-credentials/platform-credential.service'
import { AUTH_CREDENTIAL_PREFIX } from '@/lib/server/auth/auth-providers'
import { verifiedDomainCount, shouldRenderPublicButton } from '@/lib/server/auth/provider-ids'
import type { VerifiedDomain } from './settings.types'
import { invalidateSettingsCache, wrapDbError } from './settings.helpers'

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
  discoveryUrl: string | null
  authorizationUrl: string | null
  tokenUrl: string | null
  userInfoUrl: string | null
  clientId: string
  scopes: string | null
  enabled: boolean
  autoCreateUsers: boolean
  autoProvisionRole: 'admin' | 'member' | 'user' | null
  attributeMapping: IdentityProviderAttributeMapping | null
  showButton: boolean
  /** ISO-8601 UTC; null until a redirect-affecting detail changes. */
  detailsChangedAt: string | null
  /** ISO-8601 UTC; null until a test sign-in succeeds. */
  lastSuccessfulTestAt: string | null
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
  clientId: string
  discoveryUrl?: string | null
  authorizationUrl?: string | null
  tokenUrl?: string | null
  userInfoUrl?: string | null
  scopes?: string | null
  enabled?: boolean
  autoCreateUsers?: boolean
  autoProvisionRole?: 'admin' | 'member' | 'user' | null
  attributeMapping?: IdentityProviderAttributeMapping | null
  showButton?: boolean
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

// ============================================================================
// Row mappers
// ============================================================================

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

function rowToIdentityProvider(
  row: typeof identityProvider.$inferSelect,
  domains: VerifiedDomain[]
): IdentityProvider {
  return {
    id: row.id,
    registrationId: row.registrationId,
    label: row.label,
    discoveryUrl: row.discoveryUrl,
    authorizationUrl: row.authorizationUrl,
    tokenUrl: row.tokenUrl,
    userInfoUrl: row.userInfoUrl,
    clientId: row.clientId,
    scopes: row.scopes,
    enabled: row.enabled,
    autoCreateUsers: row.autoCreateUsers,
    autoProvisionRole: row.autoProvisionRole,
    attributeMapping: row.attributeMapping ?? null,
    showButton: row.showButton,
    detailsChangedAt: row.detailsChangedAt ? row.detailsChangedAt.toISOString() : null,
    lastSuccessfulTestAt: row.lastSuccessfulTestAt ? row.lastSuccessfulTestAt.toISOString() : null,
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
 */
export async function listIdentityProviders(): Promise<IdentityProvider[]> {
  try {
    const [providers, domains] = await Promise.all([
      db.select().from(identityProvider).orderBy(identityProvider.createdAt),
      db.select().from(ssoVerifiedDomain).orderBy(ssoVerifiedDomain.createdAt),
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

    return providers.map((p) => rowToIdentityProvider(p, byProvider.get(p.id) ?? []))
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
    const { bumpAuthConfigVersionInTx } = await import('@/lib/server/auth/config-version')
    const { resetAuth } = await import('@/lib/server/auth')

    const saved = await db.transaction(async (tx) => {
      const [existing] = input.id
        ? await tx.select().from(identityProvider).where(eq(identityProvider.id, input.id))
        : await tx
            .select()
            .from(identityProvider)
            .where(eq(identityProvider.registrationId, input.registrationId))

      let row: typeof identityProvider.$inferSelect
      if (existing) {
        // Patch semantics: only overwrite columns the caller supplied.
        const patch: Partial<typeof identityProvider.$inferInsert> = {
          registrationId: input.registrationId,
          label: input.label,
          clientId: input.clientId,
        }
        if (input.discoveryUrl !== undefined) patch.discoveryUrl = input.discoveryUrl
        if (input.authorizationUrl !== undefined) patch.authorizationUrl = input.authorizationUrl
        if (input.tokenUrl !== undefined) patch.tokenUrl = input.tokenUrl
        if (input.userInfoUrl !== undefined) patch.userInfoUrl = input.userInfoUrl
        if (input.scopes !== undefined) patch.scopes = input.scopes
        if (input.enabled !== undefined) patch.enabled = input.enabled
        if (input.autoCreateUsers !== undefined) patch.autoCreateUsers = input.autoCreateUsers
        if (input.autoProvisionRole !== undefined)
          patch.autoProvisionRole = input.autoProvisionRole
        if (input.attributeMapping !== undefined) patch.attributeMapping = input.attributeMapping
        if (input.showButton !== undefined) patch.showButton = input.showButton
        ;[row] = await tx
          .update(identityProvider)
          .set(patch)
          .where(eq(identityProvider.id, existing.id))
          .returning()
      } else {
        // Insert: omit `id` so the typeIdWithDefault column generates it.
        ;[row] = await tx
          .insert(identityProvider)
          .values({
            registrationId: input.registrationId,
            label: input.label,
            clientId: input.clientId,
            discoveryUrl: input.discoveryUrl ?? null,
            authorizationUrl: input.authorizationUrl ?? null,
            tokenUrl: input.tokenUrl ?? null,
            userInfoUrl: input.userInfoUrl ?? null,
            scopes: input.scopes ?? null,
            enabled: input.enabled ?? false,
            autoCreateUsers: input.autoCreateUsers ?? true,
            autoProvisionRole: input.autoProvisionRole ?? null,
            attributeMapping: input.attributeMapping ?? null,
            showButton: input.showButton ?? false,
          })
          .returning()
      }
      await bumpAuthConfigVersionInTx(tx)
      return row
    })

    resetAuth()
    await invalidateSettingsCache()

    const domains = await listDomainsForProvider(saved.id)
    return rowToIdentityProvider(saved, domains)
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
      const [row] = await tx
        .delete(identityProvider)
        .where(eq(identityProvider.id, id))
        .returning({ registrationId: identityProvider.registrationId })
      if (!row) return null
      await bumpAuthConfigVersionInTx(tx)
      return row
    })

    if (!deleted) return

    // Explicit credential cleanup — no FK cascade. This call also performs
    // the trailing resetAuth() + cache invalidation for the whole delete.
    await deletePlatformCredentials(`${AUTH_CREDENTIAL_PREFIX}${deleted.registrationId}`)
  } catch (error) {
    log.error({ err: error }, 'delete identity provider failed')
    wrapDbError('delete identity provider', error)
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
  set: { detailsChangedAt: Date } | { lastSuccessfulTestAt: Date }
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

/** Stamp `last_successful_test_at = now()` after a successful test sign-in. */
export async function markTestSucceeded(id: IdentityProviderId): Promise<void> {
  log.info({ id }, 'mark identity provider test succeeded')
  try {
    await stampTimestamp(id, { lastSuccessfulTestAt: new Date() })
  } catch (error) {
    log.error({ err: error }, 'mark identity provider test succeeded failed')
    wrapDbError('mark identity provider test succeeded', error)
  }
}
