/**
 * Enable widget visitor tabs for e2e: Home, Feedback, Help, Changelog, Messages,
 * and Tickets. `supportTickets` must be on or the public widget projection
 * strips the Tickets tab and requester ticket reads 403.
 *
 * Usage: bun set-widget-surfaces.ts <on|off>
 */
import { openDb, bustWorkspaceSettings, parseJson } from './_lib'

const mode = (process.argv[2] || 'on').toLowerCase()
if (mode !== 'on' && mode !== 'off') {
  console.error('Usage: bun set-widget-surfaces.ts <on|off>')
  process.exit(1)
}
const enabled = mode === 'on'

const sql = openDb()

try {
  const rows =
    await sql`SELECT id, feature_flags, widget_config FROM settings ORDER BY created_at ASC LIMIT 1`
  if (rows.length === 0) throw new Error('No settings row found (run the seed first)')
  const id = rows[0].id as string

  const flags = parseJson(rows[0].feature_flags)
  flags.supportInbox = enabled
  flags.supportTickets = enabled
  flags.helpCenter = enabled
  flags.changelog = enabled
  flags.feedback = true

  const widget = parseJson(rows[0].widget_config)
  widget.enabled = true
  widget.tabs = {
    ...((widget.tabs as object) ?? {}),
    home: true,
    feedback: true,
    help: enabled,
    changelog: enabled,
    messenger: enabled,
    tickets: enabled,
  }

  await sql`
    UPDATE settings
    SET feature_flags = ${JSON.stringify(flags)},
        widget_config = ${JSON.stringify(widget)}
    WHERE id = ${id}`

  await bustWorkspaceSettings(sql)
  console.log(JSON.stringify({ widgetSurfaces: mode }))
  await sql.end()
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  await sql.end()
  process.exit(1)
}
