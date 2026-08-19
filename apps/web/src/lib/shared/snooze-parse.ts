/**
 * Deterministic natural-language snooze parsing ("tomorrow morning", "next
 * week", "friday afternoon"). No LLM, no clock access of its own — `now` is
 * injected so the rules are testable. The grammar is deliberately small:
 * relative offsets, today/tomorrow with day parts or explicit clock times,
 * weekday names (English plus the agent's locale via Intl), and the preset
 * phrases the snooze menu already uses. Anything outside the grammar returns
 * null so the caller can say so instead of guessing.
 */

/** Day-part defaults (local time). Morning matches the existing snooze
 *  presets (tomorrow/next Monday at 9:00); the rest follow the same shape. */
export const SNOOZE_DAY_PART_HOURS = {
  morning: 9,
  afternoon: 14,
  evening: 18,
  night: 20,
} as const

type DayPart = keyof typeof SNOOZE_DAY_PART_HOURS
const DAY_PARTS = Object.keys(SNOOZE_DAY_PART_HOURS) as DayPart[]

export interface SnoozeParseOptions {
  now?: Date
  /** BCP-47 locale used (besides English) for weekday names. */
  locale?: string
}

/** Lower-case, collapse whitespace, strip diacritics so localized weekday
 *  names compare cleanly. */
function normalize(text: string): string {
  return text.trim().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ')
}

/** Weekday name → getDay() index for English plus `locale` (long and short
 *  forms). 2023-10-01 was a Sunday, so day i of that week formats as the
 *  weekday whose getDay() is i. */
function weekdayNames(locale?: string): Map<string, number> {
  const names = new Map<string, number>()
  const locales = ['en', ...(locale && !locale.toLowerCase().startsWith('en') ? [locale] : [])]
  for (const loc of locales) {
    for (const weekday of ['long', 'short'] as const) {
      const fmt = new Intl.DateTimeFormat(loc, { weekday })
      for (let i = 0; i < 7; i++) {
        names.set(normalize(fmt.format(new Date(2023, 9, 1 + i))), i)
      }
    }
  }
  return names
}

function setTime(day: Date, hour: number, minute = 0): Date {
  const d = new Date(day)
  d.setHours(hour, minute, 0, 0)
  return d
}

/** `hour:minute` today, or tomorrow when that time has already passed. */
function todayOrTomorrowAt(now: Date, hour: number, minute = 0): Date {
  const d = setTime(now, hour, minute)
  if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1)
  return d
}

/** Parse "at 3pm" / "at 9:30" / "at 15:00" suffixes. Null when absent or
 *  implausible (an hour 25 can never be placed). */
function parseClock(text: string): { hour: number; minute: number } | null {
  const m = /(?:^|\s)at (\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(text)
  if (!m) return null
  let hour = Number(m[1])
  const minute = m[2] ? Number(m[2]) : 0
  if (m[3] === 'pm' && hour < 12) hour += 12
  if (m[3] === 'am' && hour === 12) hour = 0
  if (hour > 23 || minute > 59) return null
  return { hour, minute }
}

/**
 * Resolve a natural-language snooze time, or null when the input is outside
 * the grammar. The result is always strictly after `now`.
 */
export function parseSnoozeTime(input: string, options: SnoozeParseOptions = {}): Date | null {
  const now = options.now ?? new Date()
  const text = normalize(input)
  if (!text) return null

  // "in N minutes/hours/days/weeks" — a straight offset from now.
  const rel = /^in (\d+) (minute|minutes|hour|hours|day|days|week|weeks)$/.exec(text)
  if (rel) {
    const n = Number(rel[1])
    if (n < 1) return null
    const unit = rel[2]!
    const d = new Date(now)
    if (unit.startsWith('minute')) d.setMinutes(d.getMinutes() + n)
    else if (unit.startsWith('hour')) d.setHours(d.getHours() + n)
    else if (unit.startsWith('day')) d.setDate(d.getDate() + n)
    else d.setDate(d.getDate() + n * 7)
    return d
  }

  // The phrases the snooze menu already offers as presets.
  if (text === 'later today') {
    const d = new Date(now)
    d.setHours(d.getHours() + 4)
    return d
  }
  if (text === 'next week') {
    const d = new Date(now)
    const diff = (8 - d.getDay()) % 7 || 7
    d.setDate(d.getDate() + diff)
    return setTime(d, SNOOZE_DAY_PART_HOURS.morning)
  }
  if (text === 'next month') {
    return new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      1,
      SNOOZE_DAY_PART_HOURS.morning,
      0,
      0,
      0
    )
  }

  // Explicit clock time, optionally anchored to today/tomorrow.
  const clock = parseClock(text)
  if (clock) {
    const day = text.startsWith('tomorrow') ? 1 : 0
    const base = new Date(now)
    base.setDate(base.getDate() + day)
    const d = setTime(base, clock.hour, clock.minute)
    if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1)
    return d
  }

  // Day parts, bare or anchored to tomorrow.
  for (const part of DAY_PARTS) {
    if (text === part || text === `tomorrow ${part}`) {
      const tomorrow = text.startsWith('tomorrow')
      if (tomorrow) {
        const d = new Date(now)
        d.setDate(d.getDate() + 1)
        return setTime(d, SNOOZE_DAY_PART_HOURS[part])
      }
      return todayOrTomorrowAt(now, SNOOZE_DAY_PART_HOURS[part])
    }
  }
  if (text === 'tomorrow') {
    const d = new Date(now)
    d.setDate(d.getDate() + 1)
    return setTime(d, SNOOZE_DAY_PART_HOURS.morning)
  }
  if (text === 'tonight') return todayOrTomorrowAt(now, SNOOZE_DAY_PART_HOURS.evening)

  // Weekdays (English + locale). "next <weekday>" is never today, matching
  // the "Next week" preset's never-today rule; a bare weekday may be today
  // when its default time is still ahead.
  const names = weekdayNames(options.locale)
  const wd = /^(next )?(\S+)(?: (morning|afternoon|evening|night))?$/.exec(text)
  if (wd) {
    const target = names.get(wd[2]!)
    if (target !== undefined) {
      const hour = SNOOZE_DAY_PART_HOURS[(wd[3] as DayPart | undefined) ?? 'morning']
      const today = now.getDay()
      let diff = (target - today + 7) % 7
      if (diff === 0 && (wd[1] || setTime(now, hour).getTime() <= now.getTime())) diff = 7
      const d = new Date(now)
      d.setDate(d.getDate() + diff)
      return setTime(d, hour)
    }
  }

  return null
}
