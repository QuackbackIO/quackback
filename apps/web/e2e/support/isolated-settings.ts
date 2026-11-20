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
  | 'feature_flags'
  | 'widget_config'
  | 'portal_config'
  | 'help_center_config'
  | 'metadata'
  | 'developer_config'

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

/** Every column these helpers may flip. */
export const ALL_SETTINGS_COLUMNS: SettingsColumn[] = [
  'feature_flags',
  'widget_config',
  'portal_config',
  'help_center_config',
  'metadata',
]

/**
 * The workspace every isolated test starts from: the support surfaces on and
 * WIDGET_BASELINE. Applied before each test and the whole settings row put
 * back after it (see `isolatedSettingsBaseline`), so a test's own flips nest
 * inside it and nothing leaks into the next test, even on a timeout.
 */
export const SETTINGS_BASELINE: SettingsPatch = {
  feature_flags: SUPPORT_FLAGS_ON,
  widget_config: WIDGET_BASELINE,
  portal_config: { 'support.enabled': true },
}

/**
 * beforeEach/afterEach bodies for an isolated spec file:
 *
 *   const baseline = isolatedSettingsBaseline()
 *   test.beforeEach(async () => { test.skip(!ISOLATED, ISOLATED_SKIP); await baseline.apply() })
 *   test.afterEach(() => baseline.restore())
 */
export function isolatedSettingsBaseline() {
  let snapshot: SettingsSnapshot | null = null
  return {
    async apply(): Promise<void> {
      snapshot = await snapshotSettings(ALL_SETTINGS_COLUMNS)
      await patchSettings(SETTINGS_BASELINE)
    },
    async restore(): Promise<void> {
      if (snapshot) await restoreSettings(snapshot)
      snapshot = null
    },
  }
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

// ---------------------------------------------------------------------------
// Plan limits (settings.tier_limits)
// ---------------------------------------------------------------------------

/**
 * Stored tier limits, as the app reads them (`tier-limits.types.ts`): caps
 * such as `maxBoards` and the `features` switches. A `null` cap is unlimited.
 */
export type TierLimitsPatch = Record<string, unknown> & {
  features?: Record<string, boolean>
}

/**
 * What a plan limits test changes: the stored limits, and the plan limits
 * state the app keeps beside them (grace clocks, chosen boards), which a cap
 * below usage can start.
 */
export interface TierLimitsSnapshot {
  tierLimits: string | null
  planLimitsState: string | null
}

/** The raw `settings.tier_limits` (null: unlimited) and `plan_limits_state`. */
export async function snapshotTierLimits(): Promise<TierLimitsSnapshot> {
  const [row] = await supportDb()<
    { tier_limits: string | null; plan_limits_state: string | null }[]
  >`SELECT tier_limits, plan_limits_state::text AS plan_limits_state FROM settings LIMIT 1`
  if (!row) throw new Error('no settings row')
  return { tierLimits: row.tier_limits ?? null, planLimitsState: row.plan_limits_state ?? null }
}

/**
 * Drop the shared cached rows the limits feed, as the app's settings writes
 * do: the settings row (the plan limits rules read the limits from it) and the
 * plan limits inputs (usage counts).
 */
async function bustTierLimitsCaches(): Promise<void> {
  await supportDb()`DELETE FROM kv_store WHERE key LIKE '%settings%' OR key LIKE '%plan-limits:%'`
}

/**
 * Write `settings.tier_limits` whole (replacement, as the app's own writer
 * does: the stored value is layered over the unlimited defaults at read time).
 * Moves `auth_config_version` too, as `writeTierLimits` in the app does, since
 * the limits decide whether identity providers register; then drops the
 * shared cached rows. The app's in-process copy of the limits lives for
 * QUACKBACK_SETTINGS_CACHE_MS, which the suite sets to 0, so the next request
 * reads the new limits and no app-side cache bust is needed.
 */
export async function writeTierLimits(text: string | null): Promise<void> {
  assertIsolated('writeTierLimits')
  await supportDb()`
    UPDATE settings
    SET tier_limits = ${text}, auth_config_version = auth_config_version + 1`
  await bustTierLimitsCaches()
}

/** Put a snapshot back exactly: the limits and the plan limits state. */
export async function restoreTierLimits(snapshot: TierLimitsSnapshot): Promise<void> {
  assertIsolated('restoreTierLimits')
  await supportDb()`
    UPDATE settings
    SET tier_limits = ${snapshot.tierLimits},
        plan_limits_state = ${snapshot.planLimitsState}::jsonb,
        auth_config_version = auth_config_version + 1`
  await bustTierLimitsCaches()
}

/**
 * Run `body` with these stored tier limits, then put the previous limits and
 * plan limits state back exactly, even when `body` throws:
 *
 *   await withTierLimits({ maxBoards: boardCount }, async () => {
 *     ... creating one more board is refused ...
 *   })
 *
 * Set a cap relative to what exists (count first): the isolated database holds
 * every earlier test's rows.
 */
export async function withTierLimits<T>(
  limits: TierLimitsPatch,
  body: () => Promise<T>
): Promise<T> {
  assertIsolated('withTierLimits')
  const snapshot = await snapshotTierLimits()
  try {
    await writeTierLimits(JSON.stringify(limits))
    return await body()
  } finally {
    await restoreTierLimits(snapshot)
  }
}
