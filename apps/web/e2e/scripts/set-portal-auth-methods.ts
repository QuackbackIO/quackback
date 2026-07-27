/**
 * CLI: disable or restore portal public auth methods in settings.auth_config
 * and settings.portal_config.
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

/** Apply the requested action to one config object's `oauth` map. */
function patchOAuth(config: Record<string, unknown>, defaults: Record<string, unknown>): void {
  const existing = (config.oauth as Record<string, unknown>) ?? {}

  if (arg === 'disable') {
    // Turn off every oauth method currently stored plus the core keys.
    // Iterating existing keys handles any dynamic OAuth providers (custom-oidc, etc.)
    // that may have been configured without this script knowing about them.
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
    config.oauth = { ...existing, magicLink: true }
  } else {
    config.oauth = { ...defaults }
  }
}

function parseJson(value: unknown): Record<string, unknown> {
  if (!value) return {}
  try {
    return JSON.parse(value as string) as Record<string, unknown>
  } catch {
    return {}
  }
}

try {
  const rows =
    await sql`SELECT id, portal_config, auth_config FROM settings ORDER BY created_at ASC LIMIT 1`
  if (rows.length === 0) throw new Error('No settings row found')
  const id = rows[0].id
  const portalConfig = parseJson(rows[0].portal_config)
  const authConfig = parseJson(rows[0].auth_config)

  // The sign-in dialog reads `publicAuthConfig`, which is derived from
  // `auth_config` — not `portal_config`. Patching only the latter leaves the
  // rendered sign-in methods untouched, so both columns move together.
  patchOAuth(portalConfig, { password: true, email: false, google: true, github: true })
  // DEFAULT_AUTH_CONFIG.oauth, plus magicLink — which is opt-in by default but
  // is how global-setup signs the admin in, so restoring without it would
  // disable the login every authenticated project depends on.
  patchOAuth(authConfig, { google: true, github: true, password: true, magicLink: true })

  await sql`
    UPDATE settings
    SET portal_config = ${JSON.stringify(portalConfig)},
        auth_config = ${JSON.stringify(authConfig)},
        auth_config_version = auth_config_version + 1
    WHERE id = ${id}`
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
