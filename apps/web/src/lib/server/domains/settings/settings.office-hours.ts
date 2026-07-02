/**
 * Office-hours settings family: the ONE workspace weekly schedule.
 *
 * Its own module per the settings-growth rule. The client-safe type + resolver
 * live in `@/lib/shared/office-hours`; this module owns the write-time zod schema
 * and persistence.
 *
 * Storage: no dedicated column exists and Phase 1 ships without a migration, so
 * the schedule rides in the generic `settings.metadata` JSON bag (the same
 * no-new-table pattern the instance-id telemetry uses). Reads default to 24/7
 * when the key is absent. Per-team schedules and holiday calendars are out of
 * scope for this object.
 */
import { db, eq, settings } from '@/lib/server/db'
import { logger } from '@/lib/server/logger'
import {
  DEFAULT_OFFICE_HOURS_SCHEDULE,
  officeHoursIntervalSchema,
  officeHoursScheduleSchema,
  officeHoursScheduleFromLegacyDays,
} from '@/lib/shared/office-hours'
import type { OfficeHoursSchedule, OfficeHoursScheduleInput } from '@/lib/shared/office-hours'
import { requireSettings, wrapDbError, invalidateSettingsCache } from './settings.helpers'

export { DEFAULT_OFFICE_HOURS_SCHEDULE, officeHoursIntervalSchema, officeHoursScheduleSchema }
export type { OfficeHoursSchedule, OfficeHoursScheduleInput }

const log = logger.child({ component: 'settings-office-hours' })

/** Key inside the `settings.metadata` JSON bag where the schedule is stored. */
const METADATA_KEY = 'officeHours'

/**
 * Resolve the schedule from the stored settings row.
 *
 * Precedence:
 *  1. An explicit `officeHours` key in the `metadata` bag (canonical) — even a
 *     disabled one wins, since it means an admin saved through the new page.
 *  2. Read-time fallback: no metadata key yet but the released
 *     `widgetConfig.messenger.officeHours` is present and enabled — convert it so
 *     upgraders keep their configured hours. Not written back; the next explicit
 *     save through the admin page persists canonically.
 *  3. Default 24/7.
 */
export function resolveOfficeHoursSchedule(
  metadataJson: string | null,
  widgetConfigJson: string | null
): OfficeHoursSchedule {
  if (metadataJson) {
    try {
      const meta = JSON.parse(metadataJson) as Record<string, unknown>
      if (METADATA_KEY in meta) {
        const parsed = officeHoursScheduleSchema.safeParse(meta[METADATA_KEY])
        return parsed.success ? parsed.data : DEFAULT_OFFICE_HOURS_SCHEDULE
      }
    } catch {
      // Fall through to the legacy fallback / default on unparseable metadata.
    }
  }
  const legacy = readLegacyOfficeHours(widgetConfigJson)
  if (legacy?.enabled) return officeHoursScheduleFromLegacyDays(legacy)
  return DEFAULT_OFFICE_HOURS_SCHEDULE
}

/** Pull the released `messenger.officeHours` blob out of raw widget-config JSON. */
function readLegacyOfficeHours(
  widgetConfigJson: string | null
): Parameters<typeof officeHoursScheduleFromLegacyDays>[0] {
  if (!widgetConfigJson) return null
  try {
    const wc = JSON.parse(widgetConfigJson) as { messenger?: { officeHours?: unknown } }
    const oh = wc?.messenger?.officeHours
    return oh && typeof oh === 'object'
      ? (oh as Parameters<typeof officeHoursScheduleFromLegacyDays>[0])
      : null
  } catch {
    return null
  }
}

export async function getOfficeHoursSchedule(): Promise<OfficeHoursSchedule> {
  try {
    const org = await requireSettings()
    return resolveOfficeHoursSchedule(org.metadata, org.widgetConfig)
  } catch (error) {
    log.error({ err: error }, 'get office hours failed')
    wrapDbError('fetch office hours', error)
  }
}

/**
 * Persist the schedule. Read-modify-writes the whole `metadata` bag so sibling
 * keys (e.g. the telemetry instance id) survive.
 */
export async function updateOfficeHoursSchedule(
  input: OfficeHoursScheduleInput
): Promise<OfficeHoursSchedule> {
  log.info('update office hours')
  try {
    const validated = officeHoursScheduleSchema.parse(input)
    const org = await requireSettings()
    let meta: Record<string, unknown> = {}
    if (org.metadata) {
      try {
        meta = JSON.parse(org.metadata) as Record<string, unknown>
      } catch {
        meta = {}
      }
    }
    meta[METADATA_KEY] = validated
    await db
      .update(settings)
      .set({ metadata: JSON.stringify(meta) })
      .where(eq(settings.id, org.id))
    await invalidateSettingsCache()
    return validated
  } catch (error) {
    log.error({ err: error }, 'update office hours failed')
    wrapDbError('update office hours', error)
  }
}
