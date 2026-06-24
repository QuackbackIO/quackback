/**
 * In-place backfill of the custom-oidc OIDC config into `identity_provider`.
 *
 * The custom-oidc path needs decryption — its `clientId` / `discoveryUrl` live
 * in the encrypted `auth_custom-oidc` platform-credential blob, not on the
 * settings row — so it can't run in the pure-SQL migration bundle (which has no
 * `SECRET_KEY` and can't import the app's encryption layer). It instead runs
 * once in-process at server startup, behind a Postgres advisory lock.
 *
 * The companion `sso` provider is backfilled by the SQL migration 0115 because
 * its `clientId` / `discoveryUrl` are plaintext on `settings.auth_config`.
 *
 * INVARIANT: `registration_id` stays `'custom-oidc'` and the credential key
 * stays `auth_custom-oidc`, so existing `account.provider_id` rows still match
 * their provider — no `account` remap, no credential re-key, no delete.
 */

import {
  db,
  eq,
  sql,
  identityProvider,
  integrationPlatformCredentials,
  settings,
  type Database,
  type Transaction,
} from '@/lib/server/db'
import { backfillUnifiedSignInMethods, parseSettingsOauth } from './backfill-signin-methods'
import { resetAuth } from './index'
import { decryptPlatformCredentials } from '@/lib/server/integrations/encryption'
import { invalidateSettingsCache } from '@/lib/server/domains/settings/settings.helpers'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'idp-backfill' })

/** DB storage key for the custom-oidc client credentials (mirrors auth_sso). */
const CUSTOM_OIDC_CREDENTIAL_TYPE = 'auth_custom-oidc' as const

/** Shape of the decrypted custom-oidc credential blob (see auth-providers.ts). */
interface CustomOidcCredentials {
  displayName?: string
  clientId?: string
  discoveryUrl?: string
  authorizationUrl?: string
  tokenUrl?: string
  scopes?: string
}

type DbOrTx = Database | Transaction

/**
 * Backfill the `custom-oidc` identity provider from its encrypted credential.
 *
 * Idempotent: returns `{ created: 0 }` when the provider already exists or when
 * there is no usable credential to migrate. All reads/writes go through the
 * passed `db` (or `tx`) so a caller's transaction — including the regression
 * pin's rollback — fully covers the work.
 */
export async function backfillCustomOidcProvider(db: DbOrTx): Promise<{ created: number }> {
  // Idempotency guard. Within a transaction the prior insert is visible here,
  // so a second call in the same tx is a no-op.
  const existing = await db
    .select({ id: identityProvider.id })
    .from(identityProvider)
    .where(eq(identityProvider.registrationId, 'custom-oidc'))
    .limit(1)
  if (existing.length > 0) return { created: 0 }

  // Read the credential off the SAME connection/tx — getPlatformCredentials()
  // would use the global pool and miss an uncommitted seed under test.
  const credRows = await db
    .select({ secrets: integrationPlatformCredentials.secrets })
    .from(integrationPlatformCredentials)
    .where(eq(integrationPlatformCredentials.integrationType, CUSTOM_OIDC_CREDENTIAL_TYPE))
    .limit(1)
  if (credRows.length === 0) return { created: 0 }

  const creds = decryptPlatformCredentials<CustomOidcCredentials>(credRows[0].secrets)
  // client_id is NOT NULL; a credential without one is unusable — nothing to do.
  if (!creds.clientId) return { created: 0 }

  await db.insert(identityProvider).values({
    registrationId: 'custom-oidc',
    label: creds.displayName?.trim() || 'Custom OIDC',
    discoveryUrl: creds.discoveryUrl ?? null,
    authorizationUrl: creds.authorizationUrl ?? null,
    tokenUrl: creds.tokenUrl ?? null,
    clientId: creds.clientId,
    scopes: creds.scopes ?? null,
    enabled: await isCustomOidcEnabled(db),
    // custom-oidc is the portal-facing sign-in button (the SSO provider is not).
    showButton: true,
  })
  await db.update(settings).set({ authConfigVersion: sql`${settings.authConfigVersion} + 1` })

  return { created: 1 }
}

/**
 * Whether custom-oidc was enabled on either sign-in surface, mirroring the
 * `isOAuthProviderEnabledForAnySurface` check in auth/index.ts. Drives the
 * provider's `enabled` flag so the backfill preserves the live on/off state.
 */
async function isCustomOidcEnabled(db: DbOrTx): Promise<boolean> {
  const rows = await db
    .select({ authConfig: settings.authConfig, portalConfig: settings.portalConfig })
    .from(settings)
    .limit(1)
  if (rows.length === 0) return false
  const team = parseSettingsOauth(rows[0].authConfig)
  const portal = parseSettingsOauth(rows[0].portalConfig)
  return team['custom-oidc'] === true || portal['custom-oidc'] === true
}

/**
 * Run once-per-deployment startup backfills behind a Postgres advisory lock.
 *
 * Invoked from `logStartupBanner()` — the established once-per-process,
 * post-DB, SECRET_KEY-present server-init seam (same place as
 * `ensureQuackbackFeedbackSource`). The transaction-scoped advisory lock
 * serialises concurrent pod boots so the provider is never double-inserted;
 * it is auto-released on commit/rollback, so there is no unlock to leak.
 */
export async function runStartupBackfills(): Promise<void> {
  let signInMethodsMerged = false
  let customOidcCreated = 0
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('quackback:identity_provider_backfill'))`
    )
    const { created } = await backfillCustomOidcProvider(tx)
    customOidcCreated = created
    if (created > 0) {
      log.info({ registration_id: 'custom-oidc' }, 'backfilled identity provider from credential')
    }
    const { merged } = await backfillUnifiedSignInMethods(tx)
    if (merged) {
      log.info('merged portal sign-in methods into authConfig.oauth')
      signInMethodsMerged = true
    }
  })
  if (signInMethodsMerged || customOidcCreated > 0) {
    resetAuth()
    await invalidateSettingsCache()
  }
}
