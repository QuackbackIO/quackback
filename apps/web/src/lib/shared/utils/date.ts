/**
 * Shared date utilities
 */

/**
 * Safely convert a date value to ISO string.
 * Handles both Date objects and ISO strings (some HTTP drivers return strings).
 */
export function toIsoString(value: Date | string): string {
  if (typeof value === 'string') {
    return value
  }
  return value.toISOString()
}

/**
 * Extract the date-only portion of a Date as YYYY-MM-DD (W3C date format).
 */
export function toIsoDateOnly(date: Date): string {
  return date.toISOString().split('T')[0]
}

/**
 * Safely convert an optional date value to ISO string or null.
 */
export function toIsoStringOrNull(value: Date | string | null | undefined): string | null {
  if (value == null) {
    return null
  }
  return toIsoString(value)
}

/** Month/year formatters (UTC), one per locale; building an Intl.DateTimeFormat per call is costly. */
const monthYearFormatters = new Map<string, Intl.DateTimeFormat>()

/**
 * Format a date at month granularity in `locale`, e.g. "Mar 2027" or
 * "mar 2027". Used for post ETAs, which are stored as the first of the target
 * month; formatting in UTC keeps the month stable regardless of the viewer's
 * timezone. Returns null for an absent or unparseable value.
 */
export function formatMonthYear(
  value: Date | string | null | undefined,
  locale = 'en-US'
): string | null {
  if (value == null) {
    return null
  }
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) {
    return null
  }
  let formatter = monthYearFormatters.get(locale)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, {
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    })
    monthYearFormatters.set(locale, formatter)
  }
  return formatter.format(date)
}

/**
 * A date-only value ("2026-10-01", or the date as written at the start of an
 * ISO timestamp) as the UTC midnight that names it. Formatted with
 * `timeZone: 'UTC'`, it reads as that day for every viewer, where parsing the
 * string as a moment would land on the day before for anyone west of UTC.
 * Null when the value does not start with a real calendar date.
 */
export function parseCalendarDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return null
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  const real =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  return real ? date : null
}

/**
 * A calendar date for display, e.g. "Oct 1, 2026": the same day for every
 * viewer, on the server and in the browser alike. Null when the value is not a
 * calendar date (see parseCalendarDate).
 */
export function formatCalendarDate(
  value: string,
  options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' },
  locale = 'en-US'
): string | null {
  const date = parseCalendarDate(value)
  if (!date) return null
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(date)
}

/**
 * A Date at `hour`:00 (browser-local) on the next calendar day, minutes and
 * below zeroed. Used for default "tomorrow morning" times (snooze wake,
 * scheduled publish).
 */
export function tomorrowAt(hour: number): Date {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(hour, 0, 0, 0)
  return d
}

/**
 * Truncate a Date to the first of its UTC month at midnight. Post ETAs are
 * month-granular and stored as this value; enforcing it keeps the month stable
 * across timezones no matter which caller supplies the timestamp.
 */
export function startOfUtcMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
}

/**
 * Now + `hours`, browser-local (the agent's timezone): minutes preserved,
 * seconds and below zeroed. Backs the "later today" snooze preset.
 */
export function inHours(hours: number): Date {
  const d = new Date()
  d.setHours(d.getHours() + hours, d.getMinutes(), 0, 0)
  return d
}

/**
 * The next Monday at `hour`:00, browser-local — never today, even when today is
 * Monday. Backs the "next week" snooze preset.
 */
export function nextMondayAt(hour: number): Date {
  const d = new Date()
  const diff = (8 - d.getDay()) % 7 || 7
  d.setDate(d.getDate() + diff)
  d.setHours(hour, 0, 0, 0)
  return d
}
