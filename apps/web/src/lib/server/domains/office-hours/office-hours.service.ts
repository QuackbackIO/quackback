/**
 * Office-hours clock math (support platform §4.6): the DST-safe resolver and
 * duration walker the SLA clocks run on. The workspace schedule itself lives in
 * the settings blob (settings.office-hours.ts, the canonical source every
 * consumer — Messenger reply-expectations, the workflows office-hours
 * condition, Quinn handover, SLA clocks — reads); this module adapts that
 * schedule to the engine shape and does the math. An empty schedule is 24/7.
 * Holidays (calendar dates the office is fully closed) ride the same engine
 * shape: the walker skips a holiday's schedule-local date like any other
 * closed day, and the resolver reports closed on it. Pure resolvers kept
 * exported + DB-free so they unit-test without a fixture.
 */
import {
  db,
  eq,
  officeHoursSchedules,
  type OfficeHoursSchedule,
  type OfficeHoursInterval,
} from '@/lib/server/db'
import type { OfficeHoursId } from '@quackback/ids'
import { logger } from '@/lib/server/logger'
// The DST-safe timezone primitives live in one place (shared with Messenger /
// Quinn / the settings resolver) so office-hours math can never drift.
import {
  zonedParts,
  zonedWallClockToUtc,
  parseHm,
  isHolidayLocalDate,
} from '@/lib/shared/office-hours'
import type {
  OfficeHoursHoliday,
  OfficeHoursSchedule as WorkspaceOfficeHoursSchedule,
} from '@/lib/shared/office-hours'

const log = logger.child({ component: 'office-hours' })

/**
 * The schedule shape the clock engine runs on: weekly windows in a timezone,
 * plus the calendar dates the office is fully closed. Pinned table rows always
 * carry `holidays` (the column defaults to '[]'); the workspace-blob adapter
 * may omit it. Absent or empty means no closed dates.
 */
export type EngineSchedule = Pick<OfficeHoursSchedule, 'timezone' | 'intervals'> & {
  holidays?: OfficeHoursHoliday[] | null
}

/** Minutes for an engine-window end: '24:00' is an exclusive end-of-day close
 *  (used by the overnight split in {@link engineScheduleFromWorkspace}). */
function parseEnd(end: string): number {
  return end === '24:00' ? 24 * 60 : parseHm(end)
}

/** Keep only well-formed windows (end after start, valid day + times). */
function validIntervals(
  intervals: OfficeHoursInterval[]
): Array<{ day: number; s: number; e: number }> {
  const out: Array<{ day: number; s: number; e: number }> = []
  for (const i of intervals) {
    const s = parseHm(i.start)
    const e = parseEnd(i.end)
    if (
      !Number.isNaN(s) &&
      !Number.isNaN(e) &&
      e > s &&
      Number.isInteger(i.day) &&
      i.day >= 0 &&
      i.day <= 6
    ) {
      out.push({ day: i.day, s, e })
    }
  }
  return out
}

/**
 * Whether an instant falls inside the schedule's open windows. A schedule with no
 * valid windows is always open (24/7), so an unconfigured workspace never blocks —
 * except on a holiday, which closes the whole schedule-local date either way.
 * DST-safe: the instant is projected into the schedule's timezone before matching.
 */
export function isWithinOfficeHours(schedule: EngineSchedule, at: Date): boolean {
  const windows = validIntervals(schedule.intervals)
  const holidays = schedule.holidays?.length ? schedule.holidays : null
  // No windows and no holidays is plain 24/7 — skip the tz projection entirely.
  if (windows.length === 0 && !holidays) return true
  const z = zonedParts(schedule.timezone || 'UTC', at)
  if (isHolidayLocalDate(holidays, z)) return false
  if (windows.length === 0) return true
  return windows.some((w) => w.day === z.weekday && z.minutes >= w.s && z.minutes < w.e)
}

// ---------------------------------------------------------------------------
// Office-hours-aware duration math (the SLA clock)
// ---------------------------------------------------------------------------

/**
 * Advance `start` by `seconds` of OPEN office-hours time and return the resulting
 * instant — the office-hours-aware SLA clock. Time outside the schedule's windows
 * does not count, and a holiday's whole schedule-local date is skipped; an empty
 * (24/7) schedule falls back to plain wall-clock unless it carries holidays.
 * Walks forward window-by-window, waiting through closed spans, DST-correct
 * throughout on the shared zonedParts + zonedWallClockToUtc primitives.
 *
 * The day-iteration bound is a BACKSTOP, not a budget: the schema caps a
 * target at one year of open seconds (functions/sla.ts's targetSecs), which
 * on an 8h/day weekdays-only schedule needs ~1100 open days (~1500+ calendar
 * days) of walking — 4000 covers that with room for holiday-dense calendars.
 * If the walk ever exhausts the bound with time still unconsumed (a
 * pathological schedule, e.g. one whose windows never advance the clock), the
 * deadline must STILL land rather than truncate silently mid-schedule: log a
 * warning and fall back to plain wall-clock from `start`.
 */
export function addOfficeHoursSeconds(
  schedule: EngineSchedule,
  start: Date,
  seconds: number
): Date {
  let windows = validIntervals(schedule.intervals)
  const holidays = schedule.holidays?.length ? schedule.holidays : null
  if (windows.length === 0) {
    // 24/7: plain wall-clock — unless holidays close some local dates, in which
    // case walk all-day windows so those dates are skipped like any closed day.
    if (!holidays) return new Date(start.getTime() + seconds * 1000)
    windows = [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, s: 0, e: 24 * 60 }))
  }
  if (seconds <= 0) return new Date(start.getTime())

  const tz = schedule.timezone || 'UTC'
  // The UTC instant of `minutesOfDay` local time on a calendar date (day may
  // overflow its month; zonedWallClockToUtc normalizes it).
  const wallToMs = (year: number, month: number, day: number, minutesOfDay: number): number =>
    zonedWallClockToUtc(
      year,
      month,
      day,
      Math.floor(minutesOfDay / 60),
      minutesOfDay % 60,
      tz
    ).getTime()

  let remaining = seconds * 1000
  let cursor = start.getTime()

  // A non-empty schedule always has open time, so this converges; the bound is
  // only a backstop against a pathological input (see this function's doc).
  for (let iter = 0; iter < 4000 && remaining > 0; iter++) {
    const z = zonedParts(tz, new Date(cursor))
    const { year, month, day, weekday } = z
    // A holiday is fully closed: skip its windows and fall through to the
    // next-local-midnight jump below.
    if (!isHolidayLocalDate(holidays, z)) {
      const todays = windows.filter((w) => w.day === weekday).sort((a, b) => a.s - b.s)
      for (const w of todays) {
        const openUtc = wallToMs(year, month, day, w.s)
        const closeUtc = wallToMs(year, month, day, w.e)
        if (cursor >= closeUtc) continue // window already elapsed today
        const from = Math.max(cursor, openUtc) // wait for open if we're early
        const available = closeUtc - from
        if (available >= remaining) return new Date(from + remaining)
        remaining -= available
        cursor = closeUtc
      }
    }
    // Nothing (more) open today — jump to the next local midnight.
    cursor = Math.max(cursor, wallToMs(year, month, day + 1, 0))
  }
  if (remaining > 0) {
    // The backstop fired: the walk consumed every iteration without covering
    // the target. Returning `cursor` here would land the deadline YEARS early
    // (truncation), so fall back to wall-clock — a deadline always lands.
    log.warn(
      { seconds, timezone: tz },
      'addOfficeHoursSeconds exhausted its iteration bound; falling back to plain wall-clock'
    )
    return new Date(start.getTime() + seconds * 1000)
  }
  return new Date(cursor)
}

// ---------------------------------------------------------------------------
// Schedule sources
// ---------------------------------------------------------------------------

/**
 * Adapt the workspace settings-blob schedule (the canonical hours source, see
 * settings.office-hours.ts) to the clock-engine shape:
 *
 *  - Disabled = 24/7 (no windows).
 *  - Overnight windows (end < start) are split at midnight into a same-day
 *    window closing at '24:00' plus a next-day window from '00:00', because the
 *    engine walks same-day windows only.
 *  - An enabled schedule with no valid windows also resolves to 24/7: "never
 *    open" would block an SLA clock forever, and a deadline must always land.
 *  - Holidays pass through only while enabled; a disabled schedule is 24/7
 *    outright, so its closed dates stay inert too.
 */
export function engineScheduleFromWorkspace(
  schedule: WorkspaceOfficeHoursSchedule
): EngineSchedule {
  if (!schedule.enabled) return { timezone: 'UTC', intervals: [] }
  const intervals: OfficeHoursInterval[] = []
  for (const iv of schedule.intervals) {
    const s = parseHm(iv.start)
    const e = parseHm(iv.end)
    if (Number.isNaN(s) || Number.isNaN(e) || s === e) continue
    if (e > s) {
      intervals.push({ day: iv.day, start: iv.start, end: iv.end })
    } else {
      intervals.push({ day: iv.day, start: iv.start, end: '24:00' })
      if (e > 0) intervals.push({ day: (iv.day + 1) % 7, start: '00:00', end: iv.end })
    }
  }
  // Blobs written before holidays existed omit the key; absent reads as none.
  return { timezone: schedule.timezone || 'UTC', intervals, holidays: schedule.holidays ?? [] }
}

/** A table schedule by id (the one an SLA policy pins), or null. The table has
 *  no workspace-level writer — only pinned rows are ever read. */
export async function getScheduleById(id: OfficeHoursId): Promise<OfficeHoursSchedule | null> {
  const [row] = await db
    .select()
    .from(officeHoursSchedules)
    .where(eq(officeHoursSchedules.id, id))
    .limit(1)
  return row ?? null
}
