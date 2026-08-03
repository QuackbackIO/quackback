/**
 * Business-hours math — PURE functions, IANA-timezone aware.
 *
 * No external deps; uses `Intl.DateTimeFormat` to extract weekday + HH:MM in
 * the calendar's timezone for each date we walk past.
 *
 * `null` business-hours = 24/7 (no math required, just add/subtract minutes).
 *
 * The interface is deliberately small:
 *   - addBusinessMinutes(start, minutes, hours) → Date
 *   - subtractBusinessMinutes(end, minutes, hours) → Date
 *   - isWithinBusinessHours(at, hours) → boolean
 *   - elapsedBusinessMs(start, end, hours) → number
 */

import type { BusinessHoursWeek, BusinessHoursRange, BusinessHoursHoliday } from '@/lib/server/db'

export interface BusinessHoursLike {
  timezone: string
  schedule: BusinessHoursWeek
  holidays: BusinessHoursHoliday[]
}

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const
type DayKey = (typeof DAY_KEYS)[number]

const MS_PER_MINUTE = 60_000

interface DateParts {
  year: number
  month: number // 1-12
  day: number // 1-31
  hour: number // 0-23
  minute: number // 0-59
  second: number // 0-59
  weekday: DayKey
}

const cachedFormatters = new Map<string, Intl.DateTimeFormat>()
function getFormatter(tz: string): Intl.DateTimeFormat {
  let f = cachedFormatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
      hour12: false,
    })
    cachedFormatters.set(tz, f)
  }
  return f
}

const WEEKDAY_MAP: Record<string, DayKey> = {
  Sun: 'sun',
  Mon: 'mon',
  Tue: 'tue',
  Wed: 'wed',
  Thu: 'thu',
  Fri: 'fri',
  Sat: 'sat',
}

function partsAt(date: Date, tz: string): DateParts {
  const parts = getFormatter(tz).formatToParts(date)
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '0'
  const weekdayRaw = get('weekday')
  const weekday = WEEKDAY_MAP[weekdayRaw] ?? 'sun'
  let hour = parseInt(get('hour'), 10)
  if (hour === 24) hour = 0 // Intl returns "24" for midnight in some locales
  return {
    year: parseInt(get('year'), 10),
    month: parseInt(get('month'), 10),
    day: parseInt(get('day'), 10),
    hour,
    minute: parseInt(get('minute'), 10),
    second: parseInt(get('second'), 10),
    weekday,
  }
}

function isoDate(parts: Pick<DateParts, 'year' | 'month' | 'day'>): string {
  const mm = String(parts.month).padStart(2, '0')
  const dd = String(parts.day).padStart(2, '0')
  return `${parts.year}-${mm}-${dd}`
}

function rangeMinutes(range: BusinessHoursRange): { startMin: number; endMin: number } {
  return { startMin: parseHHMM(range.start), endMin: parseHHMM(range.end) }
}

function parseHHMM(s: string): number {
  const [h, m] = s.split(':').map((v) => parseInt(v, 10))
  return (h ?? 0) * 60 + (m ?? 0)
}

function isHoliday(parts: DateParts, holidays: BusinessHoursHoliday[]): boolean {
  if (holidays.length === 0) return false
  const today = isoDate(parts)
  for (const h of holidays) {
    if (h.date === today) return true
  }
  return false
}

function rangesForDay(parts: DateParts, hours: BusinessHoursLike): BusinessHoursRange[] {
  if (isHoliday(parts, hours.holidays)) return []
  const day = parts.weekday
  return hours.schedule[day] ?? []
}

/**
 * Returns true iff `at` falls inside any open range for its day.
 */
export function isWithinBusinessHours(at: Date, hours: BusinessHoursLike | null): boolean {
  if (!hours) return true
  const parts = partsAt(at, hours.timezone)
  const ranges = rangesForDay(parts, hours)
  if (ranges.length === 0) return false
  const minOfDay = parts.hour * 60 + parts.minute
  for (const r of ranges) {
    const { startMin, endMin } = rangeMinutes(r)
    if (minOfDay >= startMin && minOfDay < endMin) return true
  }
  return false
}

/**
 * Walk forward from `start` accumulating only minutes that fall inside open
 * ranges. Returns a Date `minutes` of business-time after `start`.
 *
 * For 24/7 (`hours == null`): return `start + minutes`.
 *
 * Uses a day-by-day walk capped at 366 days for safety.
 */
export function addBusinessMinutes(
  start: Date,
  minutes: number,
  hours: BusinessHoursLike | null
): Date {
  if (!hours) return new Date(start.getTime() + minutes * MS_PER_MINUTE)
  if (minutes <= 0) return new Date(start.getTime())

  let cursor = new Date(start.getTime())
  let remaining = minutes
  for (let day = 0; day < 366 && remaining > 0; day++) {
    const parts = partsAt(cursor, hours.timezone)
    const ranges = rangesForDay(parts, hours)
    const minOfDay = day === 0 ? parts.hour * 60 + parts.minute : 0

    for (const r of ranges) {
      const { startMin, endMin } = rangeMinutes(r)
      const effStart = Math.max(startMin, minOfDay)
      if (effStart >= endMin) continue
      const available = endMin - effStart
      if (available >= remaining) {
        // Land inside this range. Compute wall-clock target:
        const targetMin = effStart + remaining
        return advanceToWallClock(
          cursor,
          hours.timezone,
          targetMin - (parts.hour * 60 + parts.minute)
        )
      }
      remaining -= available
    }

    // Move to start of next day in tz
    cursor = startOfNextDayInTz(cursor, hours.timezone)
  }

  // Fallback: if we exhausted 366 days (effectively closed forever) just
  // return start + linear minutes — caller will treat as best-effort.
  return new Date(start.getTime() + minutes * MS_PER_MINUTE)
}

/**
 * Subtract business-minutes (walks backward).
 */
export function subtractBusinessMinutes(
  end: Date,
  minutes: number,
  hours: BusinessHoursLike | null
): Date {
  if (!hours) return new Date(end.getTime() - minutes * MS_PER_MINUTE)
  if (minutes <= 0) return new Date(end.getTime())

  let cursor = new Date(end.getTime())
  let remaining = minutes
  for (let day = 0; day < 366 && remaining > 0; day++) {
    const parts = partsAt(cursor, hours.timezone)
    const ranges = rangesForDay(parts, hours)
    const minOfDay = day === 0 ? parts.hour * 60 + parts.minute : 24 * 60

    // iterate ranges in reverse
    for (let i = ranges.length - 1; i >= 0; i--) {
      const { startMin, endMin } = rangeMinutes(ranges[i])
      const effEnd = Math.min(endMin, minOfDay)
      if (effEnd <= startMin) continue
      const available = effEnd - startMin
      if (available >= remaining) {
        const targetMin = effEnd - remaining
        return advanceToWallClock(
          cursor,
          hours.timezone,
          targetMin - (parts.hour * 60 + parts.minute)
        )
      }
      remaining -= available
    }
    cursor = endOfPrevDayInTz(cursor, hours.timezone)
  }
  return new Date(end.getTime() - minutes * MS_PER_MINUTE)
}

/**
 * Total business-minutes between `start` and `end` (start <= end).
 * Returns 0 if `start >= end`.
 */
export function elapsedBusinessMs(start: Date, end: Date, hours: BusinessHoursLike | null): number {
  if (end.getTime() <= start.getTime()) return 0
  if (!hours) return end.getTime() - start.getTime()

  let cursor = new Date(start.getTime())
  let totalMs = 0
  for (let day = 0; day < 366; day++) {
    const parts = partsAt(cursor, hours.timezone)
    const ranges = rangesForDay(parts, hours)
    const minOfDay = day === 0 ? parts.hour * 60 + parts.minute : 0
    const endParts = partsAt(end, hours.timezone)
    const sameDay =
      endParts.year === parts.year && endParts.month === parts.month && endParts.day === parts.day

    for (const r of ranges) {
      const { startMin, endMin } = rangeMinutes(r)
      const effStart = Math.max(startMin, minOfDay)
      let effEnd = endMin
      if (sameDay) {
        effEnd = Math.min(endMin, endParts.hour * 60 + endParts.minute)
      }
      if (effEnd <= effStart) continue
      totalMs += (effEnd - effStart) * MS_PER_MINUTE
    }

    if (sameDay) break
    cursor = startOfNextDayInTz(cursor, hours.timezone)
    if (cursor.getTime() > end.getTime()) break
  }
  return totalMs
}

// ---------------------------------------------------------------------------
// timezone helpers
// ---------------------------------------------------------------------------

/**
 * Given a date and a number of "wall-clock minutes" to add (in the tz), return
 * a new Date representing that wall-clock instant.
 *
 * Implementation: convert the source instant to the tz wall-clock, add the
 * minutes, then convert back. We approximate by adjusting in real time and
 * correcting the offset via diff between expected vs actual parts.
 */
function advanceToWallClock(source: Date, tz: string, deltaMinutes: number): Date {
  // First-pass: shift by deltaMinutes in real time.
  let candidate = new Date(source.getTime() + deltaMinutes * MS_PER_MINUTE)
  // Correct for any DST jump that occurred in the interval by comparing the
  // expected wall-clock minute-of-day against the actual one (one iteration is
  // enough for standard DST shifts).
  const sourceParts = partsAt(source, tz)
  const targetMinOfDay = sourceParts.hour * 60 + sourceParts.minute + deltaMinutes
  // Wrap into [0, 1440) for same-day comparison; otherwise we just trust the shift.
  if (targetMinOfDay >= 0 && targetMinOfDay < 24 * 60) {
    const actualParts = partsAt(candidate, tz)
    const sameDay =
      actualParts.year === sourceParts.year &&
      actualParts.month === sourceParts.month &&
      actualParts.day === sourceParts.day
    if (sameDay) {
      const actualMinOfDay = actualParts.hour * 60 + actualParts.minute
      const drift = targetMinOfDay - actualMinOfDay
      if (drift !== 0) {
        candidate = new Date(candidate.getTime() + drift * MS_PER_MINUTE)
      }
    }
  }
  return candidate
}

function startOfNextDayInTz(date: Date, tz: string): Date {
  const parts = partsAt(date, tz)
  // Move forward by (24h - current wall-clock) approximated, then correct.
  const minOfDay = parts.hour * 60 + parts.minute
  const minutesToMidnight = 24 * 60 - minOfDay
  let candidate = new Date(date.getTime() + minutesToMidnight * MS_PER_MINUTE)
  // Snap back to 00:00 wall-clock if DST nudged us off.
  const cParts = partsAt(candidate, tz)
  const cMin = cParts.hour * 60 + cParts.minute
  if (cMin !== 0) {
    if (cMin <= 12 * 60) {
      candidate = new Date(candidate.getTime() - cMin * MS_PER_MINUTE)
    } else {
      candidate = new Date(candidate.getTime() + (24 * 60 - cMin) * MS_PER_MINUTE)
    }
  }
  return candidate
}

function endOfPrevDayInTz(date: Date, tz: string): Date {
  const parts = partsAt(date, tz)
  const minOfDay = parts.hour * 60 + parts.minute
  // Step back to 23:59 of the previous day in `tz`:
  // first to 00:00 today, then back 1 minute.
  let candidate = new Date(date.getTime() - minOfDay * MS_PER_MINUTE)
  // Snap to 00:00 if DST nudged us off (mirror startOfNextDayInTz).
  let cParts = partsAt(candidate, tz)
  let cMin = cParts.hour * 60 + cParts.minute
  if (cMin !== 0) {
    if (cMin <= 12 * 60) {
      candidate = new Date(candidate.getTime() - cMin * MS_PER_MINUTE)
    } else {
      candidate = new Date(candidate.getTime() + (24 * 60 - cMin) * MS_PER_MINUTE)
    }
  }
  // Now step back 1 minute so we land at 23:59 of the previous wall-clock day.
  candidate = new Date(candidate.getTime() - MS_PER_MINUTE)
  // If DST drift left us off the expected 23:59, nudge.
  cParts = partsAt(candidate, tz)
  cMin = cParts.hour * 60 + cParts.minute
  if (cMin < 23 * 60) {
    // Spring-forward case: jumped further back; push forward to 23:59.
    candidate = new Date(candidate.getTime() + (23 * 60 + 59 - cMin) * MS_PER_MINUTE)
  }
  return candidate
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Verifies an IANA timezone string by attempting to construct a formatter.
 */
export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date())
    return true
  } catch {
    return false
  }
}

/** Validate a {start, end} range string pair: HH:MM, start < end. */
export function validateRange(range: BusinessHoursRange): void {
  const re = /^([01]\d|2[0-3]):[0-5]\d$/
  if (!re.test(range.start) || !re.test(range.end)) {
    throw new Error(`invalid HH:MM range: ${range.start}-${range.end}`)
  }
  if (parseHHMM(range.start) >= parseHHMM(range.end)) {
    throw new Error(`range start must be before end: ${range.start}-${range.end}`)
  }
}

/** Validate a full week schedule: each day's ranges are sorted + non-overlapping. */
export function validateSchedule(schedule: BusinessHoursWeek): void {
  for (const day of DAY_KEYS) {
    const ranges = schedule[day] ?? []
    let lastEnd = -1
    for (const r of ranges) {
      validateRange(r)
      const startMin = parseHHMM(r.start)
      if (startMin < lastEnd) {
        throw new Error(`overlapping ranges on ${day}`)
      }
      lastEnd = parseHHMM(r.end)
    }
  }
}

/**
 * Validate a list of holidays — each must be a valid `YYYY-MM-DD` string.
 */
export function validateHolidays(holidays: BusinessHoursHoliday[]): void {
  const re = /^(\d{4})-(\d{2})-(\d{2})$/
  for (const h of holidays) {
    const m = re.exec(h.date)
    if (!m) throw new Error(`invalid holiday date: ${h.date}`)
    const [, y, mo, d] = m
    const year = Number(y)
    const month = Number(mo)
    const day = Number(d)
    const dt = new Date(Date.UTC(year, month - 1, day))
    if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) {
      throw new Error(`invalid holiday date: ${h.date}`)
    }
  }
}
