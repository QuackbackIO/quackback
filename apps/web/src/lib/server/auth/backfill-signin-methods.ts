/**
 * One-time merge of `portalConfig.oauth` into `authConfig.oauth` so the
 * workspace has a single source of truth for sign-in method flags. Union of
 * effective values: a method usable on either surface stays usable. The one
 * legacy-default exception is team magic-link: before the unified config, an
 * absent `authConfig.oauth.magicLink` meant "allowed" for team sign-in. When
 * password is explicitly off, materialize that old fallback as `true` so a
 * passwordless legacy workspace is not migrated to zero working methods.
 * Idempotent and advisory-locked via runStartupBackfills. Residual
 * portalConfig.oauth is left untouched.
 */
import { settings, eq, type Database, type Transaction } from '@/lib/server/db'
import { DEFAULT_AUTH_CONFIG } from '@/lib/server/domains/settings/settings.types'
import { bumpAuthConfigVersionInTx } from './config-version'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'signin-methods-backfill' })
type DbOrTx = Database | Transaction
type Oauth = Record<string, boolean | undefined>

/** Parse an `oauth` toggle map out of a settings JSON column; {} on bad input. */
export function parseSettingsOauth(json: string | null): Oauth {
  if (!json) return {}
  try {
    return (JSON.parse(json)?.oauth ?? {}) as Oauth
  } catch {
    return {}
  }
}

export async function backfillUnifiedSignInMethods(database: DbOrTx): Promise<{ merged: boolean }> {
  const rows = await database
    .select({
      id: settings.id,
      authConfig: settings.authConfig,
      portalConfig: settings.portalConfig,
    })
    .from(settings)
    .limit(1)
  if (rows.length === 0) return { merged: false }

  // Team oauth as the runtime sees it: stored config wins; an absent
  // authConfig falls back to the defaults (so default-on google/github are
  // never dropped). Portal contributes only its stored explicit values.
  const team = rows[0].authConfig
    ? parseSettingsOauth(rows[0].authConfig)
    : { ...DEFAULT_AUTH_CONFIG.oauth }
  const portal = parseSettingsOauth(rows[0].portalConfig)

  // Monotonic merge: copy the team config, then OR-in portal's explicit
  // enables. Never removes a method; only materializes the legacy team
  // magic-link default when password was explicitly disabled.
  const merged: Oauth = { ...team }
  const added: string[] = []
  const teamHasMagicLinkKey = Object.prototype.hasOwnProperty.call(team, 'magicLink')
  if (!teamHasMagicLinkKey && team.password === false) {
    merged.magicLink = true
    added.push('magicLink')
  }
  for (const key of Object.keys(portal)) {
    if (portal[key] === true && merged[key] !== true) {
      merged[key] = true
      added.push(key)
    }
  }

  if (JSON.stringify(merged) === JSON.stringify(team)) return { merged: false }

  const parsedAuth = JSON.parse(rows[0].authConfig ?? JSON.stringify({ ...DEFAULT_AUTH_CONFIG }))
  parsedAuth.oauth = merged
  await database
    .update(settings)
    .set({ authConfig: JSON.stringify(parsedAuth) })
    .where(eq(settings.id, rows[0].id))
  await bumpAuthConfigVersionInTx(database as Transaction)
  log.info({ keys: added }, 'merged portal-only sign-in methods into authConfig.oauth')
  return { merged: true }
}
