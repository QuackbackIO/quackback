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
  // An end of "00:00" means midnight / end-of-day (1440), not 0 — otherwise a
  // natural "09:00–00:00" range would read as closed all day.
  const endRaw = parseHm(day.end)
  const end = endRaw === 0 ? 24 * 60 : endRaw
  // Reject malformed or non-positive ranges (no overnight support).
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return false

  return cur >= start && cur < end
}

/** Offset (ms) of `tz` from UTC at `at` — positive when east of UTC. */
function tzOffsetMs(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(at)
  const num = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  let hour = num('hour')
  if (hour === 24) hour = 0
  const asUtc = Date.UTC(
    num('year'),
    num('month') - 1,
    num('day'),
    hour,
    num('minute'),
    num('second')
  )
  return asUtc - at.getTime()
}

/**
 * The UTC instant for a wall-clock time in `tz`. Single-pass DST approximation
 * (off only inside the ~1h spring-forward gap, which office hours rarely span).
 */
function zonedWallClockToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  tz: string
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute)
  const firstPass = guess - tzOffsetMs(tz, new Date(guess))
  // Re-derive the offset at the corrected instant so a DST boundary between the
  // guess and the real instant doesn't leave the result an hour off.
  return new Date(guess - tzOffsetMs(tz, new Date(firstPass)))
}

/**
 * The next instant the office opens, evaluated in the config timezone — used to
 * tell an away visitor when the team will be back. Returns the earliest opening
 * strictly after `now` (so it skips today's window once it has started), or
 * null when there's no opening within a week (disabled, misconfigured, unknown
 * timezone, or every day off).
 */
export function nextOpenAt(config: OfficeHoursConfig | null | undefined, now: Date): Date | null {
  if (!config?.enabled || !Array.isArray(config.days)) return null
  const tz = config.timezone || 'UTC'

  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now)
  } catch {
    // Unknown timezone → no reliable answer.
    return null
  }

  const value = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const dayIndex = WEEKDAY_ORDER.indexOf(value('weekday') as (typeof WEEKDAY_ORDER)[number])
  if (dayIndex < 0) return null

  let hour = Number(value('hour'))
  if (hour === 24) hour = 0
  const curMinutes = hour * 60 + Number(value('minute'))
  const year = Number(value('year'))
  const month = Number(value('month'))
  const dayOfMonth = Number(value('day'))

  // 0..7 so a single-enabled-day schedule still resolves to that same weekday
  // next week once today's window has already started.
  for (let offset = 0; offset <= 7; offset++) {
    const day = config.days[(dayIndex + offset) % 7]
    if (!day?.enabled) continue
    const start = parseHm(day.start)
    // Mirror isWithinOfficeHours: a day only opens on a valid, positive-length
    // window (00:00 end means midnight), so we never promise a "back at" time
    // for a degenerate range the schedule would report closed.
    const endRaw = parseHm(day.end)
    const end = endRaw === 0 ? 24 * 60 : endRaw
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start) continue
    // Today's window has already begun (or passed) — wait for a later day.
    if (offset === 0 && curMinutes >= start) continue
    // Date.UTC (inside zonedWallClockToUtc) normalizes the day overflow when
    // `dayOfMonth + offset` runs past the end of the month.
    return zonedWallClockToUtc(
      year,
      month,
      dayOfMonth + offset,
      Math.floor(start / 60),
      start % 60,
      tz
    )
  }
  return null
}

/**
 * The schedule's view for a chat payload: whether we're open right now, and
 * (only when the schedule says we're closed) the ISO instant we're next back.
 * Shared by the presence + chat server fns so the two payloads can't drift.
 */
export function officeHoursSnapshot(
  config: OfficeHoursConfig | null | undefined,
  now: Date
): { withinOfficeHours: boolean | null; nextOpenAt: string | null } {
  const withinOfficeHours = config?.enabled ? isWithinOfficeHours(config, now) : null
  return {
    withinOfficeHours,
    nextOpenAt:
      withinOfficeHours === false ? (nextOpenAt(config, now)?.toISOString() ?? null) : null,
  }
}
