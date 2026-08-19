/**
 * Shared date utilities
 */

/**
 * Safely convert a date value to ISO string.
 * Handles both Date objects and ISO strings (Neon HTTP driver returns strings).
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

/** Shared month/year formatter (UTC); building an Intl.DateTimeFormat per call is costly. */
const monthYearFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

/**
 * Format a date at month granularity, e.g. "Mar 2027". Used for post ETAs,
 * which are stored as the first of the target month; formatting in UTC keeps
 * the month stable regardless of the viewer's timezone. Returns null for an
 * absent or unparseable value.
 */
export function formatMonthYear(value: Date | string | null | undefined): string | null {
  if (value == null) {
    return null
  }
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) {
    return null
  }
  return monthYearFormatter.format(date)
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
