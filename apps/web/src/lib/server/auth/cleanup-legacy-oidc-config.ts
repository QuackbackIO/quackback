/**
 * Expand/contract CONTRACT step: drop the legacy single-SSO JSON once the
 * identity_provider model is the live source.
 *
 * The multi-provider model (Tasks 8-20) keeps reading two legacy shapes during
 * the migration window:
 *   - `settings.auth_config.ssoOidc` — the single-SSO blob (backfilled into the
 *     `'sso'` provider row by SQL migration 0115).
 *   - `settings.portal_config.oauth['custom-oidc']` — the legacy portal sign-in
 *     toggle (backfilled into the `'custom-oidc'` provider row at startup).
 *
 * This function removes those two JSON sources, but ONLY for whichever legacy
 * provider has provably been created — `ssoOidc` is cleared only when the
 * `'sso'` row exists, and the `custom-oidc` portal toggle is removed only when
 * the `'custom-oidc'` row exists. Credentials (`auth_sso` / `auth_custom-oidc`)
 * are NEVER touched: the registration ids are preserved, so the encrypted
 * secrets and every `account.provider_id` still resolve.
 *
 * Idempotent: re-running after the JSON is already gone is a no-op.
 *
 * DEFERRED: do NOT wire `runLegacyOidcConfigCleanup` into the live
 * `runStartupBackfills` / startup path in THIS release. Expand/contract safety:
 * never contract in the same release that expands. A rollback to a pre-Task-21
 * build must still find the source JSON, and the still-live legacy reads
 * catalogued in Task 21's Step A audit (notably `getPublicAuthConfig` ->
 * `isSsoActuallyRegistered(authConfig.ssoOidc)`, which gates the onboarding
 * one-click SSO button) would regress once `ssoOidc` is nulled. Activate in the
 * release AFTER the provider model is proven in prod AND after those category-(4)
 * reads are migrated to the provider rows.
 */

import {
  db,
  eq,
  inArray,
  sql,
  identityProvider,
  settings,
  type Database,
  type Transaction,
} from '@/lib/server/db'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'legacy-oidc-cleanup' })

type DbOrTx = Database | Transaction

export interface LegacyOidcCleanupResult {
  /** `authConfig.ssoOidc` was present and got removed. */
  clearedSsoOidc: boolean
  /** `portalConfig.oauth['custom-oidc']` was present and got removed. */
  removedCustomOidcButton: boolean
}

/** Parse a JSON settings column into a plain object; `{}` on null/garbage. */
function parseJson(raw: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

/**
 * Remove the legacy OIDC JSON sources, guarded per-provider on the existence of
 * the corresponding migrated row. Credentials are left intact. Returns which
 * sources were actually removed so callers can log/no-op accordingly.
 *
 * All reads/writes go through the passed `db` (or `tx`) so a caller's
 * transaction — including the unit test's rollback — fully covers the work.
 */
export async function cleanupLegacyOidcConfig(db: DbOrTx): Promise<LegacyOidcCleanupResult> {
  const noop: LegacyOidcCleanupResult = {
    clearedSsoOidc: false,
    removedCustomOidcButton: false,
  }

  // Guard: which legacy providers provably exist as rows now. We only contract
  // a JSON source once its provider row is the live source of truth.
  const providerRows = await db
    .select({ registrationId: identityProvider.registrationId })
    .from(identityProvider)
    .where(inArray(identityProvider.registrationId, ['sso', 'custom-oidc']))
  const present = new Set(providerRows.map((r) => r.registrationId))
  if (present.size === 0) return noop

  const rows = await db
    .select({
      id: settings.id,
      authConfig: settings.authConfig,
      portalConfig: settings.portalConfig,
    })
    .from(settings)
    .orderBy(settings.createdAt)
    .limit(1)
  if (rows.length === 0) return noop
  const row = rows[0]

  let clearedSsoOidc = false
  let removedCustomOidcButton = false

  const authConfig = parseJson(row.authConfig)
  if (present.has('sso') && authConfig.ssoOidc !== undefined) {
    delete authConfig.ssoOidc
    clearedSsoOidc = true
  }

  const portalConfig = parseJson(row.portalConfig)
  const portalOauth =
    portalConfig.oauth && typeof portalConfig.oauth === 'object'
      ? (portalConfig.oauth as Record<string, unknown>)
      : null
  if (present.has('custom-oidc') && portalOauth && 'custom-oidc' in portalOauth) {
    delete portalOauth['custom-oidc']
    removedCustomOidcButton = true
  }

  if (!clearedSsoOidc && !removedCustomOidcButton) return noop

  // Bump auth_config_version alongside the JSON write so other pods drop their
  // cached settings + rebuild Better-Auth, mirroring every other auth-config
  // mutation in the settings service.
  await db
    .update(settings)
    .set({
      ...(clearedSsoOidc && { authConfig: JSON.stringify(authConfig) }),
      ...(removedCustomOidcButton && { portalConfig: JSON.stringify(portalConfig) }),
      authConfigVersion: sql`${settings.authConfigVersion} + 1`,
    })
    .where(eq(settings.id, row.id))

  return { clearedSsoOidc, removedCustomOidcButton }
}

/**
 * Run the legacy-config cleanup once-per-deployment behind a Postgres advisory
 * lock — the same pattern as `runStartupBackfills`. The transaction-scoped lock
 * serialises concurrent pod boots; it auto-releases on commit/rollback.
 *
 * DEFERRED: intentionally NOT called from `logStartupBanner()` /
 * `runStartupBackfills` in this release (see the module docstring for the
 * expand/contract rationale and the activation preconditions).
 */
export async function runLegacyOidcConfigCleanup(): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('quackback:legacy_oidc_config_cleanup'))`
    )
    const result = await cleanupLegacyOidcConfig(tx)
    if (result.clearedSsoOidc || result.removedCustomOidcButton) {
      log.info(result, 'cleaned up legacy oidc config JSON (credentials untouched)')
    }
  })
}
