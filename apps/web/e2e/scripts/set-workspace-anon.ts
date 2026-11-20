/**
 * CLI: set the workspace `features.allowAnonymous` master switch on/off and
 * print the resulting value. settings.portal_config is a JSON *text* column,
 * so we read → patch → write. There is a single workspace settings row.
 *
 * Usage: bun set-workspace-anon.ts <true|false>
 */
import { bustWorkspaceSettings, openDb } from './_lib'

const arg = (process.argv[2] || '').toLowerCase()
if (arg !== 'true' && arg !== 'false') {
  console.error('Usage: bun set-workspace-anon.ts <true|false>')
  process.exit(1)
}
const enabled = arg === 'true'
const sql = openDb()

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
  const features = (config.features as Record<string, unknown>) ?? {}
  features.allowAnonymous = enabled
  config.features = features
  await sql`UPDATE settings SET portal_config = ${JSON.stringify(config)} WHERE id = ${id}`
  // A running server reads settings through this cache; drop it so the change is live at once.
  await bustWorkspaceSettings(sql)
  console.log(JSON.stringify({ allowAnonymous: enabled }))
  await sql.end()
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  await sql.end()
  process.exit(1)
}
