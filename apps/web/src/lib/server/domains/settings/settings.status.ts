/**
 * Status page settings family (Status Product Spec §3): enablement, the
 * portal nav tab toggle, the page visibility ladder (public / authenticated /
 * segments), and the email switches.
 *
 * Storage: like changelog and office-hours settings, these ride in the
 * generic `settings.metadata` JSON bag (no dedicated column, no migration).
 * Reads default at read time so a workspace that never customized them still
 * resolves the full default set.
 */
import {
  DEFAULT_STATUS_SETTINGS,
  statusSettingsSchema,
  type StatusSettings,
  type UpdateStatusSettingsInput,
} from '@/lib/shared/status-settings'
import { logger } from '@/lib/server/logger'
import { requireSettings, wrapDbError, writeMetadataKey } from './settings.helpers'

export { DEFAULT_STATUS_SETTINGS }
export type { StatusSettings, UpdateStatusSettingsInput }

const log = logger.child({ component: 'settings-status' })

/** Key inside the `settings.metadata` JSON bag. */
const METADATA_KEY = 'statusSettings'

/** Resolve status settings from the stored settings row's metadata bag. */
export function resolveStatusSettings(metadataJson: string | null): StatusSettings {
  if (!metadataJson) return DEFAULT_STATUS_SETTINGS
  try {
    const meta = JSON.parse(metadataJson) as Record<string, unknown>
    const parsed = statusSettingsSchema.safeParse(meta[METADATA_KEY])
    return { ...DEFAULT_STATUS_SETTINGS, ...(parsed.success ? parsed.data : {}) }
  } catch {
    return DEFAULT_STATUS_SETTINGS
  }
}

export async function getStatusSettings(): Promise<StatusSettings> {
  try {
    const org = await requireSettings()
    return resolveStatusSettings(org.metadata)
  } catch (error) {
    log.error({ err: error }, 'get status settings failed')
    wrapDbError('fetch status settings', error)
  }
}

export async function updateStatusSettings(
  input: UpdateStatusSettingsInput
): Promise<StatusSettings> {
  log.info(input, 'update status settings')
  try {
    const validated = statusSettingsSchema.parse(input)
    const existing = await getStatusSettings()
    const merged = { ...existing, ...validated }
    await writeMetadataKey(METADATA_KEY, merged)
    return merged
  } catch (error) {
    log.error({ err: error }, 'update status settings failed')
    wrapDbError('update status settings', error)
  }
}
