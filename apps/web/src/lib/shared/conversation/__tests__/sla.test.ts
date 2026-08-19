/**
 * SLA chip + formatting logic: the four countdown tones (grey >15m, yellow
 * <15m, orange <5m, red overdue), the paused state, nearest-unmet-target
 * selection, and the compact target/summary formatting the settings page and
 * workflow picker render.
 */
import { describe, expect, it } from 'vitest'
import type { ConversationSlaDTO } from '../types'
import {
  formatSlaCountdown,
  formatSlaTarget,
  nextSlaDue,
  slaChipState,
  slaTargetsSummary,
} from '../sla'

const NOW = new Date('2026-07-05T12:00:00.000Z')

const atOffset = (minutes: number): string =>
  new Date(NOW.getTime() + minutes * 60_000).toISOString()

function makeSla(extra: Partial<ConversationSlaDTO> = {}): ConversationSlaDTO {
  return {
    policyId: 'sla_policy_1',
    policyName: 'Gold',
    appliedAt: atOffset(-60),
    firstResponseDueAt: null,
    firstResponseAt: null,
    nextResponseDueAt: null,
    timeToCloseDueAt: null,
    resolvedAt: null,
    pauseOnSnooze: true,
    ...extra,
  }
}

describe('nextSlaDue', () => {
  it('returns null when the policy tracks nothing (or all clocks settled)', () => {
    expect(nextSlaDue(makeSla())).toBeNull()
    expect(
      nextSlaDue(
        makeSla({
          firstResponseDueAt: atOffset(30),
          firstResponseAt: atOffset(-10),
          timeToCloseDueAt: atOffset(120),
          resolvedAt: atOffset(-5),
        })
      )
    ).toBeNull()
  })

  it('skips a settled first-response clock and falls through to close', () => {
    const due = nextSlaDue(
      makeSla({
        firstResponseDueAt: atOffset(10),
        firstResponseAt: atOffset(-10),
        timeToCloseDueAt: atOffset(120),
      })
    )
    expect(due?.kind).toBe('close')
  })

  it('picks the nearest of multiple open clocks', () => {
    const due = nextSlaDue(
      makeSla({
        firstResponseDueAt: atOffset(-5),
        nextResponseDueAt: atOffset(20),
        timeToCloseDueAt: atOffset(120),
      })
    )
    expect(due?.kind).toBe('first_response')
  })
})

describe('slaChipState thresholds', () => {
  const chipAt = (minutesLeft: number) =>
    slaChipState(makeSla({ firstResponseDueAt: atOffset(minutesLeft) }), 'open', NOW)

  it('is grey (ok) with more than 15 minutes left', () => {
    expect(chipAt(16)?.tone).toBe('ok')
    expect(chipAt(300)?.tone).toBe('ok')
  })

  it('is yellow (due_soon) within 15 minutes', () => {
    expect(chipAt(15)?.tone).toBe('due_soon')
    expect(chipAt(6)?.tone).toBe('due_soon')
  })

  it('is orange (due_now) within 5 minutes', () => {
    expect(chipAt(5)?.tone).toBe('due_now')
    expect(chipAt(1)?.tone).toBe('due_now')
  })

  it('is red (overdue) past the deadline, labelled with the elapsed overrun', () => {
    const chip = chipAt(-90)
    expect(chip?.tone).toBe('overdue')
    expect(chip?.label).toBe('1h 30m over')
  })

  it('returns null when there is no unmet target (no chip)', () => {
    expect(slaChipState(makeSla(), 'open', NOW)).toBeNull()
  })

  it('shows paused while snoozed and the policy pauses on snooze', () => {
    const sla = makeSla({ firstResponseDueAt: atOffset(30), pauseOnSnooze: true })
    expect(slaChipState(sla, 'snoozed', NOW)).toMatchObject({ tone: 'paused', label: 'paused' })
    // A policy that keeps running through snooze counts down as usual.
    const running = makeSla({ firstResponseDueAt: atOffset(30), pauseOnSnooze: false })
    expect(slaChipState(running, 'snoozed', NOW)?.tone).toBe('ok')
  })
})

describe('formatSlaCountdown', () => {
  it('renders compact one- and two-unit durations', () => {
    expect(formatSlaCountdown(30_000)).toBe('<1m')
    expect(formatSlaCountdown(12 * 60_000)).toBe('12m')
    expect(formatSlaCountdown(4 * 3_600_000)).toBe('4h')
    expect(formatSlaCountdown(4 * 3_600_000 + 10 * 60_000)).toBe('4h 10m')
    expect(formatSlaCountdown(3 * 86_400_000 + 4 * 3_600_000)).toBe('3d 4h')
    expect(formatSlaCountdown(2 * 86_400_000)).toBe('2d')
  })
})

describe('formatSlaTarget / slaTargetsSummary', () => {
  it('renders a target in its exact largest unit', () => {
    expect(formatSlaTarget(4 * 3600)).toBe('4h')
    expect(formatSlaTarget(3 * 86400)).toBe('3d')
    expect(formatSlaTarget(90 * 60)).toBe('90m')
    expect(formatSlaTarget(45)).toBe('45s')
  })

  it('summarizes only the set targets, capitalized once', () => {
    expect(
      slaTargetsSummary({
        firstResponseTargetSecs: 4 * 3600,
        nextResponseTargetSecs: 8 * 3600,
        timeToCloseTargetSecs: 3 * 86400,
      })
    ).toBe('First response 4h · next response 8h · close 3d')
    expect(
      slaTargetsSummary({
        firstResponseTargetSecs: null,
        nextResponseTargetSecs: null,
        timeToCloseTargetSecs: 86400,
      })
    ).toBe('Close 1d')
    expect(
      slaTargetsSummary({
        firstResponseTargetSecs: null,
        nextResponseTargetSecs: null,
        timeToCloseTargetSecs: null,
      })
    ).toBe('No targets')
  })

  it('includes the resolve target only when the ticket clock is set', () => {
    expect(
      slaTargetsSummary({
        firstResponseTargetSecs: 15 * 60,
        nextResponseTargetSecs: null,
        timeToCloseTargetSecs: null,
        timeToResolveTargetSecs: 5 * 86400,
      })
    ).toBe('First response 15m · resolve 5d')
    // Three-target literals (no TTR key at all) stay exactly as before.
    expect(
      slaTargetsSummary({
        firstResponseTargetSecs: null,
        nextResponseTargetSecs: null,
        timeToCloseTargetSecs: 86400,
      })
    ).toBe('Close 1d')
  })
})
