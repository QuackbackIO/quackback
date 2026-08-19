/**
 * CLI: idempotently enable (or disable) the conversation surfaces for e2e runs.
 *
 * "on" turns on everything the three conversation surfaces need:
 *   - featureFlags.supportInbox        (gates /admin/inbox + all conversation paths)
 *   - widgetConfig.enabled             (widget master switch)
 *   - widgetConfig.messenger.enabled   (widget messenger surface)
 *   - widgetConfig.tabs.messenger      (widget Messages tab)
 *   - portalConfig.support.enabled     (portal /support tab)
 *
 * "off" flips the flag + messenger + portal support back off (the widget
 * master switch is left alone so unrelated widget specs are not disturbed).
 *
 * The settings JSON columns are *text*, so we read -> patch -> write, then
 * drop the Redis-cached tenant settings (settings:tenant) so the running dev
 * server sees the change immediately instead of after the 1h cache TTL.
 *
 * Usage: bun set-support-surfaces.ts <on|off>
 */
import { openDb, bustTenantSettings, parseJson } from './_lib'

const mode = (process.argv[2] || 'on').toLowerCase()
if (mode !== 'on' && mode !== 'off') {
  console.error('Usage: bun set-support-surfaces.ts <on|off>')
  process.exit(1)
}
const enabled = mode === 'on'

const sql = openDb()

try {
  const rows =
    await sql`SELECT id, feature_flags, widget_config, portal_config FROM settings ORDER BY created_at ASC LIMIT 1`
  if (rows.length === 0) throw new Error('No settings row found (run the seed first)')
  const id = rows[0].id as string

  const flags = parseJson(rows[0].feature_flags)
  flags.supportInbox = enabled

  const widget = parseJson(rows[0].widget_config)
  if (enabled) widget.enabled = true
  widget.messenger = { ...((widget.messenger as object) ?? {}), enabled }
  widget.tabs = { ...((widget.tabs as object) ?? {}), messenger: enabled }

  const portal = parseJson(rows[0].portal_config)
  portal.support = { ...((portal.support as object) ?? {}), enabled }

  await sql`
    UPDATE settings
    SET feature_flags = ${JSON.stringify(flags)},
        widget_config = ${JSON.stringify(widget)},
        portal_config = ${JSON.stringify(portal)}
    WHERE id = ${id}`

  // Bust the tenant-settings cache so the change is visible on the next request.
  await bustTenantSettings()

  console.log(JSON.stringify({ supportSurfaces: mode }))
  await sql.end()
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err))
  await sql.end()
  process.exit(1)
}
