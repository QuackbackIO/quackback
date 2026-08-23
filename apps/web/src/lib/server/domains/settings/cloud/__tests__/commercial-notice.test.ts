import { describe, expect, it } from 'vitest'
import { trialEndedNotice, trialNotice } from '../commercial-notice'
import type { CloudConfig } from '../cloud.types'

const NOW = new Date('2026-08-20T12:00:00.000Z')

function config(overrides: Partial<CloudConfig> = {}): CloudConfig {
  return {
    enabled: true,
    plan: 'growth',
    entitlements: {},
    subscriptionStatus: null,
    trialStartedAt: '2026-08-06T00:00:00.000Z',
    trialExpiresAt: '2026-08-22T00:00:00.000Z',
    trialActive: true,
    canUpgrade: true,
    canManageBilling: false,
    renewalAt: null,
    cancellationAt: null,
    ...overrides,
  }
}

describe('trialNotice', () => {
  it('keeps See plans until the last three days', () => {
    const notice = trialNotice(config({ trialExpiresAt: '2026-08-30T00:00:00.000Z' }), NOW)
    expect(notice).toMatchObject({
      label: 'Growth trial',
      actionLabel: 'See plans',
      message: expect.stringContaining('continue on Free'),
    })
  })

  it('switches the action to Continue with the plan in the last three days', () => {
    const notice = trialNotice(config({ trialExpiresAt: '2026-08-21T12:00:00.000Z' }), NOW)
    expect(notice?.actionLabel).toBe('Continue with Growth')
  })
})

describe('trialEndedNotice', () => {
  it('leads with keep-your-work copy and a Continue action', () => {
    const notice = trialEndedNotice(
      config({
        plan: 'free',
        trialActive: false,
        trialExpiresAt: '2026-08-18T00:00:00.000Z',
      }),
      { trialPlanName: 'Growth', now: NOW }
    )
    expect(notice).toMatchObject({
      label: 'Growth trial',
      dismissible: true,
      actionLabel: 'Continue with Growth',
    })
    expect(notice?.message).toMatch(/everything you built is still here/)
  })
})
