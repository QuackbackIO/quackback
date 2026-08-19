/**
 * CLI: enable the magic-link sign-in method in settings.auth_config.
 *
 * Post-unified-auth, magic link is opt-in via authConfig.oauth.magicLink
 * (absent = off) and the seed does not enable it — so on a fresh database the
 * e2e suite's magic-link admin sign-in (global-setup) would be refused with
 * magic_link_method_not_allowed. This script flips the method on, bumps
 * auth_config_version (so a running server drops its cached auth instance),
 * and busts the Redis-cached tenant settings.
 *
 * Idempotent; safe to run before every e2e session.
 *
 * Usage: bun enable-magic-link-method.ts
 */
import { openDb, bustTenantSettings, parseJson } from './_lib'

const sql = openDb()

try {
  const rows = await sql`SELECT id, auth_config FROM settings ORDER BY created_at ASC LIMIT 1`
  if (rows.length === 0) throw new Error('No settings row found (run the seed first)')
  const id = rows[0].id as string

  const config = parseJson(rows[0].auth_config)
  const oauth = (config.oauth as Record<string, unknown>) ?? {}
  config.oauth = { ...oauth, magicLink: true }

  await sql`
    UPDATE settings
    SET auth_config = ${JSON.stringify(config)},
        auth_config_version = auth_config_version + 1
    WHERE id = ${id}`

  await bustTenantSettings()

  console.log(JSON.stringify({ magicLink: true }))
  await sql.end()
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  await sql.end()
  process.exit(1)
}
