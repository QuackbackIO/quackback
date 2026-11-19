/**
 * Workspace-wide setting flips for the support-isolated job
 * (settings-isolated-*.spec.ts). Every flip here changes what every other test
 * on the same database sees, so these run only with E2E_SUPPORT_ISOLATED=1,
 * one worker, and always put the setting back:
 *
 *   await withSettings({ widget_config: { 'messenger.preventRepliesWhenClosed': true } }, async () => {
 *     ...
 *   })
 *
 * `withSettings` snapshots the settings columns it touches before the flip and
 * writes the snapshot back in `finally`, so a failed test leaves the workspace
 * as it found it. A raw-SQL write is seen by the app at once: the suite runs
 * with QUACKBACK_SETTINGS_CACHE_MS=0 (no per-process copy), and the shared
 * cached row in kv_store is dropped after every write.
 */
import { supportDb } from './db'
import { ISOLATED } from './automation'

/** The settings columns these helpers may flip (all JSON stored as text). */
export type SettingsColumn =
  'feature_flags' | 'widget_config' | 'portal_config' | 'help_center_config' | 'metadata'

/** Dotted path -> value, per column. A value of `undefined` deletes the key. */
export type SettingsPatch = Partial<Record<SettingsColumn, Record<string, unknown>>>

export type SettingsSnapshot = Partial<Record<SettingsColumn, string | null>>

function assertIsolated(what: string): void {
  if (!ISOLATED) throw new Error(`${what} outside the support-isolated job`)
}

/** Drop the shared cached settings row, so the next request reads the table. */
export async function bustSettingsCache(): Promise<void> {
  await supportDb()`DELETE FROM kv_store WHERE key LIKE '%settings%'`
}

/** The raw text of the given columns. */
export async function snapshotSettings(columns: SettingsColumn[]): Promise<SettingsSnapshot> {
  const [row] = await supportDb()`SELECT ${supportDb()(columns)} FROM settings LIMIT 1`
  if (!row) throw new Error('no settings row')
  return Object.fromEntries(columns.map((c) => [c, (row[c] as string | null) ?? null]))
}

/** Write a snapshot back exactly as it was. */
export async function restoreSettings(snapshot: SettingsSnapshot): Promise<void> {
  const entries = Object.entries(snapshot)
  if (entries.length === 0) return
  await supportDb()`UPDATE settings SET ${supportDb()(Object.fromEntries(entries))}`
  await bustSettingsCache()
}

function parse(text: string | null): Record<string, unknown> {
  if (!text) return {}
  try {
    const value = JSON.parse(text) as unknown
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.')
  let node = target
  for (const key of keys.slice(0, -1)) {
    const next = node[key]
    if (!next || typeof next !== 'object') node[key] = {}
    node = node[key] as Record<string, unknown>
  }
  const last = keys[keys.length - 1]
  if (value === undefined) delete node[last]
  else node[last] = value
}

/** Apply a patch to the settings row (read, merge the paths, write). */
export async function patchSettings(patch: SettingsPatch): Promise<void> {
  assertIsolated('patchSettings')
  const columns = Object.keys(patch) as SettingsColumn[]
  if (columns.length === 0) return
  const current = await snapshotSettings(columns)
  const next: Record<string, string> = {}
  for (const column of columns) {
    const json = parse(current[column] ?? null)
    for (const [path, value] of Object.entries(patch[column] ?? {})) setPath(json, path, value)
    next[column] = JSON.stringify(json)
  }
  await supportDb()`UPDATE settings SET ${supportDb()(next)}`
  await bustSettingsCache()
}

/**
 * Snapshot the columns `patch` touches, apply it, run `body`, and always write
 * the snapshot back. Nested calls each restore their own snapshot.
 */
export async function withSettings<T>(patch: SettingsPatch, body: () => Promise<T>): Promise<T> {
  assertIsolated('withSettings')
  const snapshot = await snapshotSettings(Object.keys(patch) as SettingsColumn[])
  try {
    await patchSettings(patch)
    return await body()
  } finally {
    await restoreSettings(snapshot)
  }
}

/**
 * The widget baseline the visitor-side tests assume: the messenger on, the AI
 * agent neither fronting nor answering (the automation-ai specs turn its
 * answers on in the same job and leave them on), and the default send-reopens
 * behaviour. Merge it into a test's own widget_config patch.
 */
export const WIDGET_BASELINE: Record<string, unknown> = {
  enabled: true,
  'tabs.messenger': true,
  'messenger.assistant.enabled': false,
  'messenger.assistant.respond': false,
  'messenger.preventRepliesWhenClosed': false,
}

/** Feature flags the support suite runs with (setup.support.ts turns them on). */
export const SUPPORT_FLAGS_ON: Record<string, unknown> = {
  supportInbox: true,
  supportTickets: true,
}

// ---------------------------------------------------------------------------
// Teammate availability (principal.chat_availability)
// ---------------------------------------------------------------------------

/**
 * Mark every teammate Away for `body`, so the widget reads the team as
 * offline whoever has an inbox open, then put each one back as it was.
 */
export async function withEveryTeammateAway<T>(body: () => Promise<T>): Promise<T> {
  assertIsolated('withEveryTeammateAway')
  const rows = await supportDb()<{ id: string; chat_availability: string | null }[]>`
    SELECT id, chat_availability FROM principal WHERE role IN ('admin', 'member')`
  try {
    await supportDb()`UPDATE principal SET chat_availability = 'away'
      WHERE role IN ('admin', 'member')`
    return await body()
  } finally {
    for (const row of rows) {
      await supportDb()`UPDATE principal SET chat_availability = ${row.chat_availability}
        WHERE id = ${row.id}`
    }
  }
}
