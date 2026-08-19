/**
 * The workspace office-hours schedule and its pure evaluation.
 *
 * ONE schedule per workspace: a set of weekly wall-clock intervals expressed in
 * a single IANA timezone, plus the calendar dates (holidays) the office is
 * fully closed. Every consumer (messenger reply expectations, the
 * assistant's handover copy, later the workflows condition and SLA clocks)
 * resolves it through the helpers here so their answers can never drift.
 *
 * Client-safe: no server imports, no date library (only zod, itself client-safe,
 * for the write-time schema). Timezone math is done with Intl so it stays
 * DST-correct, which means the widget can import this module directly later.
 *
 * DST semantics (see {@link zonedWallClockToUtc}):
 *  - A wall time that does not exist (spring-forward gap, e.g. 02:30 on a US
 *    "spring forward" morning) is SKIPPED FORWARD to the equivalent instant
 *    after the gap.
 *  - A wall time that repeats (fall-back) resolves to its EARLIER occurrence.
 */
import { z } from 'zod'

/** One weekly availability window, local to the schedule timezone. */
export interface OfficeHoursInterval {
  /** Weekday the window STARTS on. 0 = Sunday … 6 = Saturday. */
  day: number
  /** Local open time, "HH:MM" (24-hour). */
  start: string
  /**
   * Local close time, "HH:MM" (24-hour), exclusive. When `end` is less than
   * `start` the window spans midnight into the next day (e.g. 22:00 → 06:00).
   * `end` equal to `start` is rejected upstream (use a separate full-day
   * window instead).
   */
  end: string
}

/**
 * A calendar date the schedule is closed (support platform §4.6). `date` is
 * 'YYYY-MM-DD' in the schedule's timezone; `recurringAnnual` matches the
 * month-day every year (fixed-date holidays), otherwise the exact date only.
 * Mirrors the `office_hours_schedules.holidays` jsonb shape.
 */
export interface OfficeHoursHoliday {
  date: string
  name?: string
  recurringAnnual?: boolean
}

/** The workspace weekly office-hours schedule. */
export interface OfficeHoursSchedule {
  /** `false` = 24/7 (no schedule — always open). */
  enabled: boolean
  /** IANA timezone the interval times are expressed in (e.g. "America/New_York"). */
  timezone: string
  /** Weekly windows. Empty while `enabled` means never open. */
  intervals: OfficeHoursInterval[]
  /**
   * Closed dates, evaluated on the schedule-local calendar date. Optional
   * because blobs written before holidays existed omit it — absent means none.
   */
  holidays?: OfficeHoursHoliday[]
}

/** Default: 24/7 (disabled), no windows. Enabling it in the UI seeds a starter. */
export const DEFAULT_OFFICE_HOURS_SCHEDULE: OfficeHoursSchedule = {
  enabled: false,
  timezone: 'UTC',
  intervals: [],
  holidays: [],
}

const WEEKDAY_ORDER = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/** Whether `tz` is an IANA zone this runtime understands. */
export function isValidTimeZone(tz: string): boolean {
  if (!tz) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** "HH:MM", 24-hour, 00:00–23:59. */
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

/** Max windows across the whole week — a generous cap on a bounded editor. */
const MAX_INTERVALS = 50

/**
 * Write-time validation for one interval. Zod-only (no server imports) so the
 * settings server fn and the admin page share one definition of "valid".
 */
export const officeHoursIntervalSchema = z
  .object({
    day: z.number().int().min(0).max(6),
    start: z.string().regex(HHMM, 'time must be HH:MM (24-hour)'),
    end: z.string().regex(HHMM, 'time must be HH:MM (24-hour)'),
  })
  // start === end is degenerate; end < start is a valid overnight window.
  .refine((i) => i.start !== i.end, {
    message: 'start and end must differ (a full day is start 00:00, end 00:00 is not allowed)',
  })

/** "YYYY-MM-DD" with real month/day ranges. A day that never occurs (Feb 30)
 *  needs no finer check: it simply matches no local date. */
const YYYYMMDD = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

/** Max closed dates on a schedule — a generous cap on a bounded editor. */
const MAX_HOLIDAYS = 100

/**
 * Write-time validation for one closed date. `recurringAnnual` fills to false
 * (exact date only) when omitted.
 */
export const officeHoursHolidaySchema = z.object({
  date: z.string().regex(YYYYMMDD, 'date must be YYYY-MM-DD'),
  name: z.string().optional(),
  recurringAnnual: z.boolean().default(false),
})

export const officeHoursScheduleSchema = z.object({
  enabled: z.boolean(),
  timezone: z.string().refine(isValidTimeZone, { message: 'unknown IANA timezone' }),
  intervals: z.array(officeHoursIntervalSchema).max(MAX_INTERVALS),
  // Absent on blobs written before holidays existed → no closed dates.
  holidays: z.array(officeHoursHolidaySchema).max(MAX_HOLIDAYS).default([]),
})

export type OfficeHoursScheduleInput = z.infer<typeof officeHoursScheduleSchema>

/** Minutes since local midnight for an "HH:MM" string; NaN if malformed. Exported
 *  as a primitive the office-hours service reuses. */
export function parseHm(hm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hm ?? '')
  if (!m) return NaN
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return NaN
  return h * 60 + min
}

interface ZonedParts {
  weekday: number
  minutes: number
  year: number
  month: number
  day: number
}

// Intl.DateTimeFormat construction is expensive and the SLA clock calls zonedParts
// in a loop, so the formatter is built once per timezone.
const zonedFormatterCache = new Map<string, Intl.DateTimeFormat>()
function zonedFormatter(tz: string): Intl.DateTimeFormat {
  let f = zonedFormatterCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    zonedFormatterCache.set(tz, f)
  }
  return f
}

/** The wall-clock parts of `at` in `tz`. Throws if `tz` is unknown. Exported as a
 *  primitive the office-hours service's SLA clock reuses. */
export function zonedParts(tz: string, at: Date): ZonedParts {
  const parts = zonedFormatter(tz).formatToParts(at)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  let hour = Number(get('hour'))
  // Some runtimes emit "24" for midnight under hour12:false; normalize to 0.
  if (hour === 24) hour = 0
  return {
    weekday: WEEKDAY_ORDER.indexOf(get('weekday') as (typeof WEEKDAY_ORDER)[number]),
    minutes: hour * 60 + Number(get('minute')),
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
  }
}

/**
 * Offset (ms) of `tz` from UTC at `at` — positive when east of UTC. Rounded to
 * the whole minute (real zone offsets are minute-aligned) so the seconds that
 * {@link zonedParts} drops can't skew the result.
 */
function tzOffsetMs(tz: string, at: Date): number {
  const p = zonedParts(tz, at)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, Math.floor(p.minutes / 60), p.minutes % 60, 0)
  return Math.round((asUtc - at.getTime()) / 60000) * 60000
}

/** 'YYYY-MM-DD HH:MM' of an instant rendered in `tz` — used to detect DST gaps. */
function wallKey(tz: string, at: Date): string {
  const p = zonedParts(tz, at)
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)} ${pad(Math.floor(p.minutes / 60))}:${pad(p.minutes % 60)}`
}

/**
 * The UTC instant for a wall-clock time in `tz`. `day` may overflow its month
 * (e.g. `day = 33`); it is normalized first. Nonexistent times skip forward and
 * repeated times take the earlier occurrence — bracketing the target with the
 * offsets 12h either side of it, which straddles any single DST transition.
 */
export function zonedWallClockToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  tz: string
): Date {
  const base = new Date(Date.UTC(year, month - 1, day, hour, minute))
  const want = (() => {
    const pad = (n: number, w = 2) => String(n).padStart(w, '0')
    return `${pad(base.getUTCFullYear(), 4)}-${pad(base.getUTCMonth() + 1)}-${pad(
      base.getUTCDate()
    )} ${pad(base.getUTCHours())}:${pad(base.getUTCMinutes())}`
  })()
  const guess = base.getTime()
  const twelveH = 12 * 60 * 60 * 1000
  const offBefore = tzOffsetMs(tz, new Date(guess - twelveH))
  const offAfter = tzOffsetMs(tz, new Date(guess + twelveH))
  const candBefore = new Date(guess - offBefore)
  const candAfter = new Date(guess - offAfter)
  const okBefore = wallKey(tz, candBefore) === want
  const okAfter = wallKey(tz, candAfter) === want
  if (okBefore && okAfter) {
    // Repeated wall time (fall-back): take the earlier occurrence.
    return candBefore.getTime() <= candAfter.getTime() ? candBefore : candAfter
  }
  if (okBefore) return candBefore
  if (okAfter) return candAfter
  // Nonexistent wall time (spring-forward gap): skip forward past the gap.
  return candBefore.getTime() >= candAfter.getTime() ? candBefore : candAfter
}

/**
 * Whether the schedule-local calendar date `z` (year/month/day in the
 * schedule's timezone, e.g. from {@link zonedParts}) is a holiday: an exact
 * 'YYYY-MM-DD' match, or — for a `recurringAnnual` entry — a month-day match
 * (fixed-date holidays like 12-25). Pure date arithmetic, so DST never enters
 * into it. Exported as a primitive the office-hours clock engine reuses.
 */
export function isHolidayLocalDate(
  holidays: OfficeHoursHoliday[] | null | undefined,
  z: { year: number; month: number; day: number }
): boolean {
  if (!holidays?.length) return false
  const pad = (n: number) => String(n).padStart(2, '0')
  const monthDay = `${pad(z.month)}-${pad(z.day)}`
  return holidays.some(
    (h) =>
      h.date === `${z.year}-${monthDay}` ||
      (h.recurringAnnual === true && h.date.slice(5) === monthDay)
  )
}

/**
 * Whether `at` falls within office hours, evaluated in the schedule timezone.
 *
 *  - Disabled schedule → 24/7 → always `true`.
 *  - Enabled with no intervals → never open → `false`.
 *  - Unknown timezone → fails closed (`false`).
 *  - A holiday (exact date or recurring month-day) → closed the whole local day.
 *
 * Overnight windows (`end < start`) count the evening portion on their `day`
 * and the early-morning portion on the following day.
 */
export function isWithinOfficeHours(
  schedule: OfficeHoursSchedule | null | undefined,
  at: Date
): boolean {
  if (!schedule?.enabled) return true // 24/7
  if (!Array.isArray(schedule.intervals) || schedule.intervals.length === 0) return false

  let z: ZonedParts
  try {
    z = zonedParts(schedule.timezone || 'UTC', at)
  } catch {
    return false
  }
  if (z.weekday < 0) return false
  // A holiday closes the whole local day, whatever the windows say.
  if (isHolidayLocalDate(schedule.holidays, z)) return false

  const cur = z.minutes
  const prevDay = (z.weekday + 6) % 7
  for (const iv of schedule.intervals) {
    const start = parseHm(iv.start)
    const end = parseHm(iv.end)
    if (Number.isNaN(start) || Number.isNaN(end) || start === end) continue
    if (end > start) {
      // Same-day window [start, end).
      if (iv.day === z.weekday && cur >= start && cur < end) return true
    } else {
      // Overnight: [start, 24:00) on iv.day, then [00:00, end) the next day.
      if (iv.day === z.weekday && cur >= start) return true
      if (iv.day === prevDay && cur < end) return true
    }
  }
  return false
}

/**
 * The next instant the office opens strictly after `from`, evaluated in the
 * schedule timezone — for "back online at …" copy shown while closed.
 *
 * Returns `null` when there is nothing to wait for: a disabled (24/7) schedule,
 * no intervals, an unknown timezone, or only degenerate windows. When `from`
 * is inside an open window this returns the NEXT window's opening (the current
 * one has already started).
 */
export function nextOpenAt(
  schedule: OfficeHoursSchedule | null | undefined,
  from: Date
): Date | null {
  if (!schedule?.enabled) return null // 24/7 — always open
  if (!Array.isArray(schedule.intervals) || schedule.intervals.length === 0) return null
  const tz = schedule.timezone || 'UTC'

  let z: ZonedParts
  try {
    z = zonedParts(tz, from)
  } catch {
    return null
  }
  if (z.weekday < 0) return null

  let best: Date | null = null
  const holidays = schedule.holidays?.length ? schedule.holidays : null
  // 0..7 so a single-window-per-week schedule still resolves to that weekday
  // next week once today's window has already started.
  for (let offset = 0; offset <= 7; offset++) {
    const weekday = (z.weekday + offset) % 7
    for (const iv of schedule.intervals) {
      if (iv.day !== weekday) continue
      const start = parseHm(iv.start)
      const end = parseHm(iv.end)
      if (Number.isNaN(start) || Number.isNaN(end) || start === end) continue
      const instant = zonedWallClockToUtc(
        z.year,
        z.month,
        z.day + offset,
        Math.floor(start / 60),
        start % 60,
        tz
      )
      // A window whose schedule-local date is a holiday never opens.
      if (holidays && isHolidayLocalDate(holidays, zonedParts(tz, instant))) continue
      if (instant.getTime() > from.getTime() && (!best || instant.getTime() < best.getTime())) {
        best = instant
      }
    }
  }
  return best
}

/** "HH:MM" for minutes-since-midnight (0–1439). */
function toHhmm(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/**
 * The released `widgetConfig.messenger.officeHours` shape (seven per-weekday
 * entries, index 0 = Sunday). Typed loosely because it is parsed from stored
 * JSON. Only the migration mapper below understands it.
 */
interface LegacyOfficeHoursConfig {
  enabled?: boolean
  timezone?: string
  days?: Array<{ enabled?: boolean; start?: string; end?: string } | null>
}

/**
 * Convert the released per-weekday office-hours config into the interval model,
 * preserving its exact evaluation: only enabled days become windows, an end of
 * "00:00" means midnight / end-of-day, and any range whose end is not strictly
 * after its start is dropped (the legacy evaluator reported those closed and had
 * no overnight support). A legacy full day (00:00–00:00) has no single-interval
 * representation and is dropped. Used for the read-time fallback so a self-hoster
 * upgrading keeps their configured hours until they next save canonically.
 */
export function officeHoursScheduleFromLegacyDays(
  legacy: LegacyOfficeHoursConfig | null | undefined
): OfficeHoursSchedule {
  const intervals: OfficeHoursInterval[] = []
  const days = Array.isArray(legacy?.days) ? legacy.days : []
  days.forEach((day, index) => {
    if (index > 6 || !day?.enabled) return
    const start = parseHm(day.start ?? '')
    const rawEnd = parseHm(day.end ?? '')
    if (Number.isNaN(start) || Number.isNaN(rawEnd)) return
    // A legacy end of 00:00 meant midnight / end-of-day, not 0.
    const end = rawEnd === 0 ? 24 * 60 : rawEnd
    // Non-positive ranges (incl. inverted ones) never opened under the legacy
    // evaluator, so they must not silently become overnight windows.
    if (end <= start) return
    const startHm = toHhmm(start)
    // Emit 00:00 for an end-of-day close; the interval model reads a close at or
    // before the open as running to midnight on the same weekday.
    const endHm = end === 24 * 60 ? '00:00' : toHhmm(end)
    // A full day (00:00–00:00) can't be one interval (start === end is rejected).
    if (startHm === endHm) return
    intervals.push({ day: index, start: startHm, end: endHm })
  })
  return {
    enabled: Boolean(legacy?.enabled),
    timezone: legacy?.timezone || 'UTC',
    intervals,
    // The legacy config has no holiday concept.
    holidays: [],
  }
}

/**
 * The schedule's view for a conversation payload: whether we're open right now,
 * and (only when the schedule says we're closed) the ISO instant we're next
 * back. Shared by the presence + conversation server fns so the two payloads
 * can't drift. `withinOfficeHours` is null for a disabled (24/7) schedule, so
 * callers fall back to live-agent presence.
 */
export function officeHoursSnapshot(
  schedule: OfficeHoursSchedule | null | undefined,
  now: Date
): { withinOfficeHours: boolean | null; nextOpenAt: string | null } {
  const withinOfficeHours = schedule?.enabled ? isWithinOfficeHours(schedule, now) : null
  return {
    withinOfficeHours,
    nextOpenAt:
      withinOfficeHours === false ? (nextOpenAt(schedule, now)?.toISOString() ?? null) : null,
  }
}
