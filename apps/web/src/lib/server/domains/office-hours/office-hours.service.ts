/**
 * Office hours (support platform §4.6): the one workspace schedule + the DST-safe
 * resolver every consumer (Messenger reply-expectations, the workflows
 * office-hours condition, Quinn handover, SLA clocks) uses the same way. An empty
 * or unconfigured schedule is 24/7. Pure resolver kept exported + DB-free so it
 * unit-tests without a fixture.
 */
import {
  db,
  eq,
  officeHoursSchedules,
  type OfficeHoursSchedule,
  type OfficeHoursInterval,
} from '@/lib/server/db'
import type { OfficeHoursId } from '@quackback/ids'
// The DST-safe timezone primitives live in one place (shared with Messenger /
// Quinn / the settings resolver) so office-hours math can never drift.
import { zonedParts, zonedWallClockToUtc, parseHm } from '@/lib/shared/office-hours'

/** Keep only well-formed windows (end after start, valid day + times). */
function validIntervals(
  intervals: OfficeHoursInterval[]
): Array<{ day: number; s: number; e: number }> {
  const out: Array<{ day: number; s: number; e: number }> = []
  for (const i of intervals) {
    const s = parseHm(i.start)
    const e = parseHm(i.end)
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
 * valid windows is always open (24/7), so an unconfigured workspace never blocks.
 * DST-safe: the instant is projected into the schedule's timezone before matching.
 */
export function isWithinOfficeHours(
  schedule: Pick<OfficeHoursSchedule, 'timezone' | 'intervals'>,
  at: Date
): boolean {
  const windows = validIntervals(schedule.intervals)
  if (windows.length === 0) return true
  const { weekday, minutes } = zonedParts(schedule.timezone || 'UTC', at)
  return windows.some((w) => w.day === weekday && minutes >= w.s && minutes < w.e)
}

// ---------------------------------------------------------------------------
// Office-hours-aware duration math (the SLA clock)
// ---------------------------------------------------------------------------

/**
 * Advance `start` by `seconds` of OPEN office-hours time and return the resulting
 * instant — the office-hours-aware SLA clock. Time outside the schedule's windows
 * does not count; an empty (24/7) schedule falls back to plain wall-clock. Walks
 * forward window-by-window, waiting through closed spans, DST-correct throughout
 * on the shared zonedParts + zonedWallClockToUtc primitives.
 */
export function addOfficeHoursSeconds(
  schedule: Pick<OfficeHoursSchedule, 'timezone' | 'intervals'>,
  start: Date,
  seconds: number
): Date {
  const windows = validIntervals(schedule.intervals)
  if (windows.length === 0) return new Date(start.getTime() + seconds * 1000)
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

  // A non-empty schedule always has open time, so this converges quickly; the
  // bound is only a backstop against a pathological input.
  for (let iter = 0; iter < 400 && remaining > 0; iter++) {
    const { year, month, day, weekday } = zonedParts(tz, new Date(cursor))
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
    // Nothing (more) open today — jump to the next local midnight.
    cursor = Math.max(cursor, wallToMs(year, month, day + 1, 0))
  }
  return new Date(cursor)
}

// ---------------------------------------------------------------------------
// The one workspace schedule (v1)
// ---------------------------------------------------------------------------

/** A schedule by id (e.g. the one an SLA policy pins), or null. */
export async function getScheduleById(id: OfficeHoursId): Promise<OfficeHoursSchedule | null> {
  const [row] = await db
    .select()
    .from(officeHoursSchedules)
    .where(eq(officeHoursSchedules.id, id))
    .limit(1)
  return row ?? null
}

/** The workspace's default schedule, or null when none is configured (= 24/7). */
export async function getDefaultSchedule(): Promise<OfficeHoursSchedule | null> {
  const [row] = await db
    .select()
    .from(officeHoursSchedules)
    .where(eq(officeHoursSchedules.isDefault, true))
    .limit(1)
  return row ?? null
}

/** Create or update the single default schedule (the workspace's one schedule). */
export async function upsertDefaultSchedule(input: {
  name?: string
  timezone: string
  intervals: OfficeHoursInterval[]
}): Promise<OfficeHoursSchedule> {
  const existing = await getDefaultSchedule()
  if (existing) {
    const [updated] = await db
      .update(officeHoursSchedules)
      .set({
        name: input.name ?? existing.name,
        timezone: input.timezone,
        intervals: input.intervals,
        updatedAt: new Date(),
      })
      .where(eq(officeHoursSchedules.id, existing.id))
      .returning()
    return updated
  }
  const [created] = await db
    .insert(officeHoursSchedules)
    .values({
      name: input.name ?? 'Default',
      timezone: input.timezone,
      intervals: input.intervals,
      isDefault: true,
    })
    .returning()
  return created
}

/** Whether the workspace is within office hours now (or at `at`). Unconfigured
 *  = 24/7. The shared entry point for every consumer. */
export async function isWorkspaceWithinOfficeHours(at: Date = new Date()): Promise<boolean> {
  const schedule = await getDefaultSchedule()
  return schedule ? isWithinOfficeHours(schedule, at) : true
}
