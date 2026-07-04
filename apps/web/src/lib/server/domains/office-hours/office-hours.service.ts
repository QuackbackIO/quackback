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

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

// Intl.DateTimeFormat construction is expensive, and the SLA clock builds these
// in a tight loop (up to hundreds of iterations, several formatters each). Cache
// them by timezone + shape so each is constructed once per process.
const formatterCache = new Map<string, Intl.DateTimeFormat>()
function cachedFormatter(
  shape: string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions
): Intl.DateTimeFormat {
  const key = `${shape}|${timeZone}`
  let formatter = formatterCache.get(key)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', ...options })
    formatterCache.set(key, formatter)
  }
  return formatter
}

/** Minutes since local midnight for an 'HH:MM' string, or null when malformed. */
function parseHHMM(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!m) return null
  const hours = parseInt(m[1], 10)
  const minutes = parseInt(m[2], 10)
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

/** The local weekday (0=Sun..6=Sat) + minutes-since-midnight for an instant in a
 *  timezone, DST-safe via Intl (it applies the zone's offset for that date). */
function localParts(at: Date, timeZone: string): { day: number; minutes: number } {
  const parts = cachedFormatter('dayMinute', timeZone, {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(at)
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun'
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10)
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10)
  return { day: WEEKDAY_INDEX[weekday] ?? 0, minutes: (hour % 24) * 60 + minute }
}

/** Keep only well-formed windows (end after start, valid day + times). */
function validIntervals(
  intervals: OfficeHoursInterval[]
): Array<{ day: number; s: number; e: number }> {
  const out: Array<{ day: number; s: number; e: number }> = []
  for (const i of intervals) {
    const s = parseHHMM(i.start)
    const e = parseHHMM(i.end)
    if (s !== null && e !== null && e > s && Number.isInteger(i.day) && i.day >= 0 && i.day <= 6) {
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
  const { day, minutes } = localParts(at, schedule.timezone)
  return windows.some((w) => w.day === day && minutes >= w.s && minutes < w.e)
}

// ---------------------------------------------------------------------------
// Office-hours-aware duration math (the SLA clock)
// ---------------------------------------------------------------------------

/** The timezone's UTC offset in ms at an instant (local ahead of UTC = positive),
 *  read AT that instant via Intl so it is DST-correct. */
function tzOffsetMs(timeZone: string, at: Date): number {
  const parts = cachedFormatter('offset', timeZone, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at)
  const g = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? 0)
  const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'))
  return asUtc - at.getTime()
}

/** The UTC epoch-ms of a local wall-clock time in a timezone. One refinement pass
 *  handles the offset shift across a DST boundary; office-hours windows never
 *  span the transition hour, so the gap/overlap ambiguities don't arise here. */
function localToUtcMs(
  tz: string,
  y: number,
  month0: number,
  d: number,
  hh: number,
  mm: number
): number {
  const guess = Date.UTC(y, month0, d, hh, mm)
  const off1 = tzOffsetMs(tz, new Date(guess))
  let utc = guess - off1
  const off2 = tzOffsetMs(tz, new Date(utc))
  if (off2 !== off1) utc = guess - off2
  return utc
}

/** The local calendar date + weekday of an instant in a timezone. */
function localDateParts(
  tz: string,
  at: Date
): { year: number; month0: number; day: number; weekday: number } {
  const parts = cachedFormatter('dateWeekday', tz, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(at)
  const g = (t: string): string => parts.find((p) => p.type === t)?.value ?? ''
  return {
    year: Number(g('year')),
    month0: Number(g('month')) - 1,
    day: Number(g('day')),
    weekday: WEEKDAY_INDEX[g('weekday')] ?? 0,
  }
}

/**
 * Advance `start` by `seconds` of OPEN office-hours time and return the resulting
 * instant — the office-hours-aware SLA clock. Time outside the schedule's windows
 * does not count; an empty (24/7) schedule falls back to plain wall-clock. Walks
 * forward window-by-window, waiting through closed spans, DST-correct throughout.
 */
export function addOfficeHoursSeconds(
  schedule: Pick<OfficeHoursSchedule, 'timezone' | 'intervals'>,
  start: Date,
  seconds: number
): Date {
  const windows = validIntervals(schedule.intervals)
  if (windows.length === 0) return new Date(start.getTime() + seconds * 1000)
  if (seconds <= 0) return new Date(start.getTime())

  const tz = schedule.timezone
  let remaining = seconds * 1000
  let cursor = start.getTime()

  // A non-empty schedule always has open time, so this converges quickly; the
  // bound is only a backstop against a pathological input.
  for (let iter = 0; iter < 400 && remaining > 0; iter++) {
    const { year, month0, day, weekday } = localDateParts(tz, new Date(cursor))
    const todays = windows.filter((w) => w.day === weekday).sort((a, b) => a.s - b.s)
    for (const w of todays) {
      const openUtc = localToUtcMs(tz, year, month0, day, Math.floor(w.s / 60), w.s % 60)
      const closeUtc = localToUtcMs(tz, year, month0, day, Math.floor(w.e / 60), w.e % 60)
      if (cursor >= closeUtc) continue // window already elapsed today
      const from = Math.max(cursor, openUtc) // wait for open if we're early
      const available = closeUtc - from
      if (available >= remaining) return new Date(from + remaining)
      remaining -= available
      cursor = closeUtc
    }
    // Nothing (more) open today — jump to the next local midnight.
    cursor = Math.max(cursor, localToUtcMs(tz, year, month0, day + 1, 0, 0))
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
