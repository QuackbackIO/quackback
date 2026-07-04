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

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
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
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
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
// The one workspace schedule (v1)
// ---------------------------------------------------------------------------

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
