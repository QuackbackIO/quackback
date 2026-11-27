/**
 * The plan limits emails' pure parts: which email is due when, how the
 * deadline reads, the rows and feature names each email lists, and how the
 * stored email record is read back.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { deadlineText, dueEmailKind, emailRows, pausingFeatureKeys } from '../plan-limits.emails'
import { PLAN_FEATURE_LINKS } from '../plan-limits.features'
import { parseEmailState } from '../plan-limits.email-state'
import { PLAN_FEATURE_KEYS } from '../plan-limits.features'
import { graceEndFor, planLimitsDeadlineDay, type PlanLimitsView } from '../plan-limits.rules'

const DAY = 24 * 60 * 60 * 1000
const SINCE = '2026-11-16T09:00:00.000Z'
const END = '2026-11-24T12:00:00.000Z'

function view(overrides: Partial<PlanLimitsView>): PlanLimitsView {
  return {
    enabled: true,
    phase: 'grace',
    since: SINCE,
    graceEndsAt: END,
    issues: [],
    featureIssues: [],
    ...overrides,
  } as PlanLimitsView
}

describe('dueEmailKind', () => {
  const end = Date.parse(END)

  it('sends the start email until two days before the end, then the reminder', () => {
    expect(dueEmailKind(view({}), new Date(Date.parse(SINCE)))).toBe('start')
    expect(dueEmailKind(view({}), new Date(end - 2 * DAY - 1))).toBe('start')
    expect(dueEmailKind(view({}), new Date(end - 2 * DAY))).toBe('reminder')
    expect(dueEmailKind(view({}), new Date(end - 1))).toBe('reminder')
  })

  it('sends the enforcement email once the phase is enforced', () => {
    expect(dueEmailKind(view({ phase: 'enforced' }), new Date(end + 1))).toBe('enforced')
  })

  it('sends nothing when plan limits are off, the workspace fits, or no grace is stored', () => {
    const now = new Date(end - DAY)
    expect(dueEmailKind(view({ enabled: false }), now)).toBeNull()
    expect(dueEmailKind(view({ phase: 'ok' }), now)).toBeNull()
    expect(dueEmailKind(view({ since: null }), now)).toBeNull()
    expect(dueEmailKind(view({ graceEndsAt: null }), now)).toBeNull()
    expect(dueEmailKind(view({ enabled: false, phase: 'enforced' }), now)).toBeNull()
  })
})

describe('deadlineText', () => {
  it("writes the date in the reader's language", () => {
    const at = new Date('2026-11-23T12:00:00.000Z')
    expect(deadlineText(at, new Date(SINCE), 'de')).toEqual({
      deadline: '23. Nov.',
      deadlineHeading: 'Mo., 23. Nov.',
    })
  })

  const previousTz = process.env.TZ
  afterEach(() => {
    if (previousTz === undefined) delete process.env.TZ
    else process.env.TZ = previousTz
  })

  it('reads the UTC calendar day whatever the server zone', () => {
    // Late in the UTC day: a server east of UTC would already be on the 24th,
    // one west of it still on the 23rd for an early instant.
    for (const tz of ['Pacific/Kiritimati', 'Pacific/Pago_Pago', 'UTC']) {
      process.env.TZ = tz
      expect(deadlineText(new Date('2026-11-23T23:30:00.000Z'), new Date(SINCE))).toEqual({
        deadline: 'Nov 23',
        deadlineHeading: 'Mon, Nov 23',
      })
      expect(deadlineText(new Date('2026-11-23T00:30:00.000Z'), new Date(SINCE)).deadline).toBe(
        'Nov 23'
      )
    }
  })

  it('adds the year only when it differs from the current one', () => {
    const at = new Date('2027-01-02T12:00:00.000Z')
    expect(deadlineText(at, new Date('2026-12-28T00:00:00.000Z'))).toEqual({
      deadline: 'Jan 2, 2027',
      deadlineHeading: 'Sat, Jan 2, 2027',
    })
    expect(deadlineText(at, new Date('2027-01-01T00:00:00.000Z')).deadline).toBe('Jan 2')
  })

  it('names the last full day to fix: the day before the grace ends, for any start time', () => {
    // From the first second of a UTC day to its last, across the noon cut-off.
    for (const since of [
      '2026-11-16T00:00:00.000Z',
      '2026-11-16T11:59:59.000Z',
      '2026-11-16T12:00:01.000Z',
      '2026-11-16T23:59:59.000Z',
    ]) {
      const end = graceEndFor(new Date(since))
      const day = planLimitsDeadlineDay(end.toISOString())
      expect(day).toBe(new Date(end.getTime() - DAY).toISOString().slice(0, 10))
      // The shown day has ended everywhere down to UTC-12 when the pause lands.
      const dayEndsAtMinus12 = Date.parse(`${day}T00:00:00.000Z`) + DAY + 12 * 60 * 60 * 1000
      expect(dayEndsAtMinus12).toBeLessThanOrEqual(end.getTime())
      expect(deadlineText(new Date(`${day}T12:00:00.000Z`), new Date(since)).deadline).toBe(
        deadlineText(new Date(end.getTime() - DAY), new Date(since)).deadline
      )
    }
  })
})

describe('emailRows', () => {
  it('carries the cap, usage and limit of each issue in order, for the email to word', () => {
    const rows = emailRows(
      view({
        issues: [
          { key: 'maxBoards', used: 5, cap: 1 },
          { key: 'maxTeamSeats', used: 3, cap: 1 },
        ] as never,
      })
    )
    expect(rows).toEqual([
      { key: 'maxBoards', used: 5, cap: 1 },
      { key: 'maxTeamSeats', used: 3, cap: 1 },
    ])
  })
})

describe('pausingFeatureKeys', () => {
  it('names every feature the Plan limits page names, so the email never drops one', () => {
    const issues = PLAN_FEATURE_KEYS.map((key) => ({ key, count: 1 }))
    expect(pausingFeatureKeys(view({ featureIssues: issues as never })).sort()).toEqual(
      Object.keys(PLAN_FEATURE_LINKS).sort()
    )
  })
})

describe('parseEmailState', () => {
  it('keeps known kinds and well-formed recipients only', () => {
    expect(
      parseEmailState({
        emailsSent: ['start', 'bogus', 'enforced'],
        emailRecipients: {
          start: {
            a: { status: 'sent', at: '2026-11-16T09:00:00.000Z' },
            b: { status: 'claimed', at: '2026-11-16T09:00:00.000Z' },
            c: { status: 'delivered', at: '2026-11-16T09:00:00.000Z' },
            d: { status: 'sent', at: 'not a date' },
            e: null,
          },
          bogus: { a: { status: 'sent', at: '2026-11-16T09:00:00.000Z' } },
          reminder: [],
        },
      })
    ).toEqual({
      emailsSent: ['start', 'enforced'],
      emailRecipients: {
        start: {
          a: { status: 'sent', at: '2026-11-16T09:00:00.000Z' },
          b: { status: 'claimed', at: '2026-11-16T09:00:00.000Z' },
        },
      },
    })
  })

  it('reads nothing from a state with no email record', () => {
    expect(parseEmailState({})).toEqual({})
    expect(parseEmailState({ emailsSent: 'start', emailRecipients: ['start'] })).toEqual({})
    expect(parseEmailState({ emailsSent: [], emailRecipients: { start: {} } })).toEqual({})
  })
})
