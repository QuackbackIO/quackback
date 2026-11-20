/**
 * The plan limits emails' pure parts: which email is due when, how the
 * deadline reads, the rows and feature names each email lists, and how the
 * stored email record is read back.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { deadlineText, dueEmailKind, emailRows, pausingFeatureLabels } from '../plan-limits.emails'
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
  const effect = (key: string, used: number, cap: number) =>
    emailRows(view({ issues: [{ key, used, cap }] as never }))[0]!.effect

  it('reads every cap as a full sentence, singular and plural', () => {
    expect(effect('maxStatusComponents', 4, 3)).toBe(
      '1 status component is hidden from your status page'
    )
    expect(effect('maxStatusComponents', 6, 3)).toBe(
      '3 status components are hidden from your status page'
    )
    expect(effect('maxCustomRoles', 2, 1)).toBe('1 custom role is locked')
    expect(effect('maxSendingDomains', 3, 1)).toBe('2 sending domains are paused')
    expect(effect('maxHelpCenterLocales', 2, 1)).toBe('1 help center language is locked')
    expect(effect('maxBoards', 5, 1)).toBe('4 boards become read-only')
    expect(effect('maxBoards', 2, 1)).toBe('1 board becomes read-only')
    expect(effect('maxTeamSeats', 2, 1)).toBe('1 teammate loses admin access until a seat frees up')
    expect(effect('maxTeamSeats', 4, 1)).toBe('3 teammates lose admin access until a seat frees up')
  })

  it('carries the label, usage and cap of each issue in order', () => {
    const rows = emailRows(
      view({
        issues: [
          { key: 'maxBoards', used: 5, cap: 1 },
          { key: 'maxTeamSeats', used: 3, cap: 1 },
        ] as never,
      })
    )
    expect(rows.map(({ label, used, cap }) => [label, used, cap])).toEqual([
      ['Boards', 5, 1],
      ['Team seats', 3, 1],
    ])
  })
})

describe('pausingFeatureLabels', () => {
  it('names every feature that can pause, so the email never lists a blank', () => {
    const issues = PLAN_FEATURE_KEYS.map((key) => ({ key, count: 1 }))
    const labels = pausingFeatureLabels(view({ featureIssues: issues as never }))
    // Each key the loaders count as set up has a name.
    for (const key of [
      'workflows',
      'webhooks',
      'integrations',
      'sso',
      'customDomain',
      'customCss',
      'aiAssistant',
      'aiArticleTranslation',
    ]) {
      expect(
        pausingFeatureLabels(view({ featureIssues: [{ key, count: 1 }] as never }))
      ).toHaveLength(1)
    }
    for (const label of labels) expect(label.trim()).not.toBe('')
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
