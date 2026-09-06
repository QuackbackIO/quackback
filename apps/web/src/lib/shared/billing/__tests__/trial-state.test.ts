import { describe, expect, it } from 'vitest'
import { daysUntil, isTrialEnded } from '../trial-state'

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
