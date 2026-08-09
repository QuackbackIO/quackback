/**
 * A minute-resolution cron evaluator, for the schedules the sweep tier runs.
 *
 * Deliberately small and deliberately strict. It supports exactly the standard
 * five-field syntax this codebase uses — wildcard, literal, range, list, and
 * either of those with a step (`every-nth`) — and **throws on anything else**
 * rather than falling back to a
 * permissive reading. A cron expression that is quietly mis-parsed changes a
 * sweep's cadence with no error anywhere, which is precisely the class of defect
 * a scheduler should not be able to have.
 *
 * Time is local, matching the cadence the BullMQ repeatable jobs ran on (their
 * repeat options set no `tz`, so the parser used the process timezone). "Daily
 * at 03:00" therefore still means 03:00 where the process runs.
 *
 * Slots are found by walking minute by minute within a bounded window rather
 * than by solving the fields. That is a few thousand cheap comparisons at worst,
 * runs once per slot rather than per tick, and — unlike a closed-form
 * solution — cannot silently disagree with the matcher that decides whether a
 * given minute is a slot, because it *is* that matcher.
 */

/** Bound on the slot search. Every schedule in this codebase fires at least daily. */
const SEARCH_WINDOW_MINUTES = 48 * 60

const FIELD_RANGES: ReadonlyArray<{ name: string; min: number; max: number }> = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day-of-month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'day-of-week', min: 0, max: 6 },
]

export interface ParsedCron {
  readonly pattern: string
  /** One set of permitted values per field, in FIELD_RANGES order. */
  readonly fields: ReadonlyArray<ReadonlySet<number>>
  /** True when the day-of-month field is unrestricted (`*`). */
  readonly domUnrestricted: boolean
  /** True when the day-of-week field is unrestricted (`*`). */
  readonly dowUnrestricted: boolean
}

function parseField(raw: string, idx: number): Set<number> {
  const { name, min, max } = FIELD_RANGES[idx]
  const out = new Set<number>()

  for (const part of raw.split(',')) {
    if (part === '') throw new Error(`cron ${name} field has an empty term in "${raw}"`)

    const [rangePart, stepPart, ...extra] = part.split('/')
    if (extra.length > 0) throw new Error(`cron ${name} field has multiple steps in "${part}"`)

    let step = 1
    if (stepPart !== undefined) {
      if (!/^\d+$/.test(stepPart)) throw new Error(`cron ${name} step must be a number: "${part}"`)
      step = Number(stepPart)
      if (step < 1) throw new Error(`cron ${name} step must be >= 1: "${part}"`)
    }

    let lo: number
    let hi: number
    if (rangePart === '*') {
      lo = min
      hi = max
    } else if (/^\d+$/.test(rangePart)) {
      lo = Number(rangePart)
      // A bare number with a step means "from here to the end of the range",
      // which is how every cron implementation reads `5/15`.
      hi = stepPart === undefined ? lo : max
    } else {
      const m = /^(\d+)-(\d+)$/.exec(rangePart)
      if (!m) throw new Error(`cron ${name} field term is not supported: "${part}"`)
      lo = Number(m[1])
      hi = Number(m[2])
      if (lo > hi) throw new Error(`cron ${name} range is inverted: "${part}"`)
    }

    if (lo < min || hi > max) {
      throw new Error(`cron ${name} value out of range ${min}-${max}: "${part}"`)
    }
    for (let v = lo; v <= hi; v += step) out.add(v)
  }

  if (out.size === 0) throw new Error(`cron ${name} field matched nothing: "${raw}"`)
  return out
}

/** Parse a five-field cron expression. Throws on anything it does not fully support. */
export function parseCron(pattern: string): ParsedCron {
  const parts = pattern.trim().split(/\s+/)
  if (parts.length !== 5) {
    throw new Error(
      `cron pattern must have exactly 5 fields (minute hour day-of-month month day-of-week), ` +
        `received ${parts.length}: "${pattern}"`
    )
  }
  const fields = parts.map((p, i) => parseField(p, i))
  return {
    pattern,
    fields,
    domUnrestricted: parts[2] === '*',
    dowUnrestricted: parts[4] === '*',
  }
}

/**
 * Does `date` fall on a slot of this schedule?
 *
 * Day-of-month and day-of-week use cron's traditional OR rule when both are
 * restricted, and AND (which for an unrestricted field is a no-op) otherwise.
 */
export function matchesCron(cron: ParsedCron, date: Date): boolean {
  const [minutes, hours, dom, months, dow] = cron.fields
  if (!minutes.has(date.getMinutes())) return false
  if (!hours.has(date.getHours())) return false
  if (!months.has(date.getMonth() + 1)) return false

  const domHit = dom.has(date.getDate())
  const dowHit = dow.has(date.getDay())
  if (cron.domUnrestricted && cron.dowUnrestricted) return true
  if (cron.domUnrestricted) return dowHit
  if (cron.dowUnrestricted) return domHit
  return domHit || dowHit
}

function floorToMinute(date: Date): Date {
  const d = new Date(date.getTime())
  d.setSeconds(0, 0)
  return d
}

/**
 * The most recent slot at or before `now`, or null if none within the window.
 *
 * This is what the scheduler enqueues: the current slot, not a backlog of missed
 * ones. A tier that was down for three hours therefore runs an hourly sweep once
 * on restart rather than three times, which is the behaviour the repeatable jobs
 * had.
 */
export function latestSlotAtOrBefore(cron: ParsedCron, now: Date): Date | null {
  const cursor = floorToMinute(now)
  for (let i = 0; i < SEARCH_WINDOW_MINUTES; i++) {
    if (matchesCron(cron, cursor)) return new Date(cursor.getTime())
    cursor.setMinutes(cursor.getMinutes() - 1)
  }
  return null
}

/** The first slot strictly after `now`, or null if none within the window. */
export function nextSlotAfter(cron: ParsedCron, now: Date): Date | null {
  const cursor = floorToMinute(now)
  cursor.setMinutes(cursor.getMinutes() + 1)
  for (let i = 0; i < SEARCH_WINDOW_MINUTES; i++) {
    if (matchesCron(cron, cursor)) return new Date(cursor.getTime())
    cursor.setMinutes(cursor.getMinutes() + 1)
  }
  return null
}

/**
 * The dedupe key for one slot of one schedule.
 *
 * Local wall-clock, to the minute. The queue's unique index on
 * `(queue, dedupe_key)` is what makes a slot spendable exactly once — two
 * replicas racing the same tick produce one row, decided by the database rather
 * than by a lock.
 */
export function slotKey(scheduleName: string, slot: Date): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return (
    `${scheduleName}:${slot.getFullYear()}-${pad(slot.getMonth() + 1)}-${pad(slot.getDate())}` +
    `T${pad(slot.getHours())}:${pad(slot.getMinutes())}`
  )
}
