/**
 * CLI: switch Copilot on Home (the copilotHome feature flag) on or off for
 * e2e runs, then drop the cached workspace settings so the dev server sees it.
 *
 * Usage: bun set-copilot-home.ts <on|off>
 */
import { openDb, bustWorkspaceSettings, parseJson } from './_lib'

const mode = (process.argv[2] || 'on').toLowerCase()
if (mode !== 'on' && mode !== 'off') {
  console.error('Usage: bun set-copilot-home.ts <on|off>')
  process.exit(1)
}

const sql = openDb()

try {
  const rows = await sql`SELECT id, feature_flags FROM settings ORDER BY created_at ASC LIMIT 1`
  if (rows.length === 0) throw new Error('No settings row found (run the seed first)')
  const flags = parseJson(rows[0].feature_flags)
  flags.copilotHome = mode === 'on'
  await sql`UPDATE settings SET feature_flags = ${JSON.stringify(flags)} WHERE id = ${rows[0].id}`
  await bustWorkspaceSettings(sql)
  console.log(JSON.stringify({ copilotHome: mode }))
  await sql.end()
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  await sql.end()
  process.exit(1)
}
