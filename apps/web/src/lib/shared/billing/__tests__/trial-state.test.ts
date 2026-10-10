import { describe, expect, it } from 'vitest'
import { daysUntil, isTrialEnded, TRIAL_CHOICE_GATE_FROM, trialChoiceDueAt } from '../trial-state'

const NOW = new Date('2026-08-20T12:00:00.000Z')

describe('isTrialEnded', () => {
  it('is true on Free after a trial window until they subscribe', () => {
    expect(
      isTrialEnded({
        plan: 'free',
        trialActive: false,
        trialExpiresAt: '2026-08-18T00:00:00.000Z',
        status: null,
        now: NOW,
      })
    ).toBe(true)
  })

  it('is false while the trial is still running', () => {
    expect(
      isTrialEnded({
        plan: 'pro',
        trialActive: true,
        trialExpiresAt: '2026-08-22T00:00:00.000Z',
        status: null,
        now: NOW,
      })
    ).toBe(false)
  })

  it('is false after a paid conversion', () => {
    expect(
      isTrialEnded({
        plan: 'free',
        trialActive: false,
        trialExpiresAt: '2026-08-18T00:00:00.000Z',
        status: 'active',
        now: NOW,
      })
    ).toBe(false)
  })

  it('stays true more than seven days after expiry until they subscribe', () => {
    expect(
      isTrialEnded({
        plan: 'free',
        trialActive: false,
        trialExpiresAt: '2026-08-01T00:00:00.000Z',
        status: null,
        now: NOW,
      })
    ).toBe(true)
  })
})

describe('daysUntil', () => {
  it('ceils remaining whole days', () => {
    expect(daysUntil('2026-08-22T00:00:00.000Z', NOW)).toBe(2)
  })
})

describe('trialChoiceDueAt', () => {
  const ended = (trialExpiresAt: string, now: string) => ({
    plan: 'free',
    trialActive: false,
    trialExpiresAt,
    status: null,
    now: new Date(now),
  })

  it('is two days after an ended trial nobody has chosen for', () => {
    expect(
      trialChoiceDueAt(ended('2026-11-02T12:00:00.000Z', '2026-11-03T00:00:00.000Z'))?.toISOString()
    ).toBe('2026-11-04T12:00:00.000Z')
  })

  it('gives trials that ended before the choice existed until the cutover', () => {
    expect(trialChoiceDueAt(ended('2026-08-19T12:00:00.000Z', '2026-10-12T00:00:00.000Z'))).toEqual(
      new Date(TRIAL_CHOICE_GATE_FROM)
    )
  })

  it('is null while the trial runs, once Free closed it, and once they subscribe', () => {
    const base = ended('2026-11-02T12:00:00.000Z', '2026-11-03T00:00:00.000Z')
    expect(trialChoiceDueAt({ ...base, plan: 'pro', trialActive: true })).toBeNull()
    expect(trialChoiceDueAt({ ...base, trialExpiresAt: null })).toBeNull()
    expect(trialChoiceDueAt({ ...base, status: 'active' })).toBeNull()
  })
})
