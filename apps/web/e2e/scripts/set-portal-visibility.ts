/**
 * CLI: set portal visibility to 'public' or 'private' in settings.portal_config.
 * settings.portal_config is a JSON *text* column, so we read → patch → write.
 * There is a single workspace settings row.
 *
 * When set to 'private': unauthenticated visitors hit the PortalAccessGate
 * before seeing any portal content. Used by e2e tests that verify the gate
 * renders with the dialog auto-opened (journey 3).
 *
 * Always restore to 'public' in a `finally` block so subsequent tests and
 * dev sessions are not left with a locked portal.
 *
 * Usage: bun set-portal-visibility.ts <private|public>
 */
import postgres from 'postgres'

const arg = (process.argv[2] || '').toLowerCase()
if (arg !== 'private' && arg !== 'public') {
  console.error('Usage: bun set-portal-visibility.ts <private|public>')
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

  // Merge the visibility into the access sub-object, preserving other keys.
  const existingAccess = (config.access as Record<string, unknown>) ?? {}
  config.access = { ...existingAccess, visibility: arg }

  await sql`UPDATE settings SET portal_config = ${JSON.stringify(config)} WHERE id = ${id}`
  console.log(JSON.stringify({ action: 'set-portal-visibility', visibility: arg }))
  await sql.end()
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  await sql.end()
  process.exit(1)
}
