/**
 * CLI: disable or restore portal public auth methods in settings.portal_config.
 * settings.portal_config is a JSON *text* column, so we read → patch → write.
 * There is a single workspace settings row.
 *
 * When disabling: all stored oauth keys plus the known core methods (password,
 * magicLink) are set to false — no portal sign-in method is presented to
 * public users. The team break-glass form (TeamLoginForm) still appears for
 * team-bound callbackUrls; that is the invariant this helper enables testing.
 *
 * When restoring: oauth is reset to the default portal config values
 * (mirrors DEFAULT_PORTAL_CONFIG.oauth — password + standard OAuth on,
 * magicLink off).
 *
 * Usage: bun set-portal-auth-methods.ts <disable|restore>
 */
import postgres from 'postgres'

const arg = (process.argv[2] || '').toLowerCase()
if (arg !== 'disable' && arg !== 'restore' && arg !== 'enable-magic-link') {
  console.error('Usage: bun set-portal-auth-methods.ts <disable|restore|enable-magic-link>')
  process.exit(1)
}

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_URL environment variable is required')
  process.exit(1)
}
const sql = postgres(connectionString)

try {
  const rows = await sql`SELECT id, portal_config FROM settings ORDER BY created_at ASC LIMIT 1`
  if (rows.length === 0) throw new Error('No settings row found')
  const id = rows[0].id
  let config: Record<string, unknown> = {}
  if (rows[0].portal_config) {
    try {
      config = JSON.parse(rows[0].portal_config as string)
    } catch {
      config = {}
    }
  }

  if (arg === 'disable') {
    // Turn off every portal oauth method currently stored plus the core keys.
    // Iterating existing keys handles any dynamic OAuth providers (custom-oidc, etc.)
    // that may have been configured without this script knowing about them.
    const existing = (config.oauth as Record<string, unknown>) ?? {}
    const disabled: Record<string, unknown> = {}
    for (const key of Object.keys(existing)) {
      disabled[key] = false
    }
    // Ensure the canonical methods are explicitly disabled even if not yet stored.
    disabled.password = false
    disabled.magicLink = false
    config.oauth = disabled
  } else if (arg === 'enable-magic-link') {
    // Enable only the magicLink method, leaving other settings untouched. Used
    // by test setup that needs to sign in portal users (role='user') on repeat
    // runs: the hooks check blocks magic-link for existing portal users when
    // magicLink is off, so we open it just for the sign-in then restore.
    const existing = (config.oauth as Record<string, unknown>) ?? {}
    config.oauth = { ...existing, magicLink: true }
  } else {
    // Restore to the default portal oauth config (mirrors DEFAULT_PORTAL_CONFIG.oauth).
    config.oauth = { password: true, email: false, google: true, github: true }
  }

  await sql`UPDATE settings SET portal_config = ${JSON.stringify(config)} WHERE id = ${id}`
  // Echo only the action. The resulting oauth flags are deterministic per
  // action, callers ignore this output, and logging the oauth object trips
  // clear-text-logging analysis on the `oauth` property name even though
  // these are just boolean enable flags, not secrets.
  console.log(JSON.stringify({ action: arg }))
  await sql.end()
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  await sql.end()
  process.exit(1)
}
