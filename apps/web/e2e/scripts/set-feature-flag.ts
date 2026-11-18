/**
 * CLI: turn one workspace feature flag (settings.feature_flags) on or off,
 * then bust the cached workspace settings so a running server sees it at once.
 *
 * A spec that needs a module (for example the help center) turns it on itself
 * instead of relying on another spec having done so earlier in the run: with
 * sharding, that other spec may run on a different machine.
 *
 * Usage: bun set-feature-flag.ts <flag> <on|off>
 */
import { bustWorkspaceSettings, openDb, parseJson } from './_lib'

const [flag, mode] = process.argv.slice(2)
if (!flag || (mode !== 'on' && mode !== 'off')) {
  console.error('Usage: bun set-feature-flag.ts <flag> <on|off>')
  process.exit(1)
}

const sql = openDb()

try {
  const rows = await sql`SELECT id, feature_flags FROM settings ORDER BY created_at ASC LIMIT 1`
  if (rows.length === 0) throw new Error('No settings row found (run the seed first)')
  const flags = parseJson(rows[0].feature_flags)
  flags[flag] = mode === 'on'
  await sql`UPDATE settings SET feature_flags = ${JSON.stringify(flags)} WHERE id = ${rows[0].id}`
  await bustWorkspaceSettings(sql)
  console.log(JSON.stringify({ [flag]: flags[flag] }))
  await sql.end()
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  await sql.end()
  process.exit(1)
}
