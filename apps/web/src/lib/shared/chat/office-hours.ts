/**
 * Pure office-hours evaluation, shared by the server (to tell the widget whether
 * the team is currently available) and tests. Timezone-correct via Intl, with no
 * external date library.
 */
import type { OfficeHoursConfig } from './types'

const WEEKDAY_ORDER = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/** Minutes since local midnight for an "HH:mm" string; NaN if malformed. */
function parseHm(hm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm ?? '')
  if (!m) return NaN
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return NaN
  return h * 60 + min
}

/**
 * Whether `now` falls within the configured weekly office hours, evaluated in
 * the config's timezone. Returns false when disabled, misconfigured, or the
 * timezone is unknown — callers treat "false" as away.
 */
export function isWithinOfficeHours(config: OfficeHoursConfig, now: Date): boolean {
  if (!config?.enabled || !Array.isArray(config.days)) return false

  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: config.timezone || 'UTC',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now)
  } catch {
    // Unknown timezone → fail closed (away).
    return false
  }

  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? ''
  const dayIndex = WEEKDAY_ORDER.indexOf(weekday as (typeof WEEKDAY_ORDER)[number])
  if (dayIndex < 0) return false

  const day = config.days[dayIndex]
  if (!day?.enabled) return false

  // Some runtimes emit "24" for midnight under hour12:false; normalize to 0.
  let hour = Number(parts.find((p) => p.type === 'hour')?.value)
  if (hour === 24) hour = 0
  const cur = hour * 60 + Number(parts.find((p) => p.type === 'minute')?.value)

  const start = parseHm(day.start)
  const end = parseHm(day.end)
  // Reject malformed or non-positive ranges (no overnight support).
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return false

  return cur >= start && cur < end
}
