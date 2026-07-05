/**
 * Changelog settings family (Changelog Settings §2): audience, the portal
 * nav tab toggle, the collaboration toggle, and the two email switches
 * (auto-subscribe / disable changelog emails).
 *
 * Storage: like office-hours and ticket settings, these ride in the generic
 * `settings.metadata` JSON bag (no dedicated column, no migration). Reads
 * default at read time so a workspace that never customized them still
 * resolves the full default set.
 */
import {
  DEFAULT_CHANGELOG_SETTINGS,
  changelogSettingsSchema,
  type ChangelogSettings,
  type UpdateChangelogSettingsInput,
} from '@/lib/shared/changelog-settings'
import { logger } from '@/lib/server/logger'
import { requireSettings, wrapDbError, writeMetadataKey } from './settings.helpers'

export { DEFAULT_CHANGELOG_SETTINGS }
export type { ChangelogSettings, UpdateChangelogSettingsInput }

const log = logger.child({ component: 'settings-changelog' })

/** Key inside the `settings.metadata` JSON bag. */
const METADATA_KEY = 'changelogSettings'

/** Resolve changelog settings from the stored settings row's metadata bag. */
export function resolveChangelogSettings(metadataJson: string | null): ChangelogSettings {
  if (!metadataJson) return DEFAULT_CHANGELOG_SETTINGS
  try {
    const meta = JSON.parse(metadataJson) as Record<string, unknown>
    const parsed = changelogSettingsSchema.safeParse(meta[METADATA_KEY])
    return { ...DEFAULT_CHANGELOG_SETTINGS, ...(parsed.success ? parsed.data : {}) }
  } catch {
    return DEFAULT_CHANGELOG_SETTINGS
  }
}

export async function getChangelogSettings(): Promise<ChangelogSettings> {
  try {
    const org = await requireSettings()
    return resolveChangelogSettings(org.metadata)
  } catch (error) {
    log.error({ err: error }, 'get changelog settings failed')
    wrapDbError('fetch changelog settings', error)
  }
}

export async function updateChangelogSettings(
  input: UpdateChangelogSettingsInput
): Promise<ChangelogSettings> {
  log.info(input, 'update changelog settings')
  try {
    const validated = changelogSettingsSchema.parse(input)
    const existing = await getChangelogSettings()
    const merged = { ...existing, ...validated }
    await writeMetadataKey(METADATA_KEY, merged)
    return merged
  } catch (error) {
    log.error({ err: error }, 'update changelog settings failed')
    wrapDbError('update changelog settings', error)
  }
}
