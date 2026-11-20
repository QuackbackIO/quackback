import { describe, expect, it } from 'vitest'
import { trialEndedNotice, trialNotice } from '../commercial-notice'
import type { CloudConfig } from '../cloud.types'

const NOW = new Date('2026-08-20T12:00:00.000Z')

function config(overrides: Partial<CloudConfig> = {}): CloudConfig {
  return {
    enabled: true,
    plan: 'pro',
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
  it('keeps Compare plans until the last three days', () => {
    const notice = trialNotice(config({ trialExpiresAt: '2026-08-30T00:00:00.000Z' }), NOW)
    expect(notice).toMatchObject({
      label: 'Pro trial',
      actionLabel: 'Compare plans',
      message: expect.stringContaining('upgrade to keep everything'),
    })
  })

  it('switches the action to Upgrade to the plan in the last three days', () => {
    const notice = trialNotice(config({ trialExpiresAt: '2026-08-21T12:00:00.000Z' }), NOW)
    expect(notice?.actionLabel).toBe('Upgrade to Pro')
  })
})

describe('trialEndedNotice', () => {
  const ended = config({
    plan: 'free',
    trialActive: false,
    trialExpiresAt: '2026-08-19T00:00:00.000Z',
  })

  it('asks a billing manager to choose, with no deadline', () => {
    const notice = trialEndedNotice(ended, { trialPlanName: 'Pro', now: NOW })
    expect(notice).toMatchObject({
      label: 'Pro trial ended',
      ended: true,
      actionLabel: 'Compare plans',
      actionUrl: '/admin/settings/billing',
    })
    expect(notice).not.toHaveProperty('choiceDueAt')
    expect(notice?.message).toBe('Upgrade to Pro to keep everything, or downgrade to Free.')
  })

  it('never asks for billing details: the trial never had any', () => {
    const notice = trialEndedNotice(ended, { trialPlanName: 'Pro', now: NOW })
    expect(notice?.message).not.toMatch(/billing information/)
  })

  it('gives a teammate the news without a button or a deadline, naming who decides', () => {
    const notice = trialEndedNotice(ended, { now: NOW, canManageBilling: false })
    expect(notice?.message).toMatch(/Ask someone who manages billing to upgrade/)
    expect(notice).toMatchObject({ label: 'Trial ended', ended: true })
    expect(notice).not.toHaveProperty('actionUrl')
    expect(notice).not.toHaveProperty('choiceDueAt')
  })

  it('is gone once Free closed the trial', () => {
    expect(
      trialEndedNotice(config({ plan: 'free', trialActive: false, trialExpiresAt: null }), {
        now: NOW,
      })
    ).toBeNull()
  })
})
