/**
 * The plan limits email: its three variants and their mail classes.
 */
import { describe, expect, it } from 'vitest'
import { render } from '@react-email/components'
import { PlanLimitsEmail, planLimitsTitle } from '../templates/plan-limits'
import {
  EMAIL_BILLABLE,
  EMAIL_TENANTED,
  METERED_EMAIL_TYPES,
  isEmailBillable,
  isTenantedEmailType,
} from '../mail-class'

function visibleText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/[^\x20-\x7e]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/ ([.,:])/g, '$1')
    .trim()
}

const base = {
  workspaceName: 'Acme Support',
  planName: 'Free',
  fromPlanName: 'Pro',
  graceEnds: '25 November 2026',
  rows: [
    { label: 'Boards', used: 5, cap: 1, effect: '4 become read-only' },
    { label: 'Team seats', used: 3, cap: 1, effect: '2 lose admin access' },
  ],
  pausingFeatures: ['Webhooks', 'Custom domain'],
  limitsUrl: 'https://app.example.com/admin/settings/billing/limits',
  planUrl: 'https://app.example.com/admin/settings/billing',
}

describe('PlanLimitsEmail', () => {
  it('start: names what to fix by the date, what pauses, and that nothing is deleted', async () => {
    const html = await render(PlanLimitsEmail({ ...base, kind: 'start' }))
    const text = visibleText(html)
    expect(text).toContain('Fix 2 things by 25 November 2026')
    expect(text).toContain('Boards: 5 of 1. 4 become read-only.')
    expect(text).toContain('Team seats: 3 of 1. 2 lose admin access.')
    expect(text).toContain('Webhooks, Custom domain pause.')
    expect(text).toContain('Nothing is deleted.')
    expect(text).toContain('Review what to fix')
    expect(text).toContain('Keep Pro')
    expect(html).toContain('href="https://app.example.com/admin/settings/billing/limits"')
    expect(html).toContain('href="https://app.example.com/admin/settings/billing"')
  })

  it('reminder: says 2 days left with the same content', async () => {
    const text = visibleText(await render(PlanLimitsEmail({ ...base, kind: 'reminder' })))
    expect(text).toContain('2 days left. Fix 2 things by 25 November 2026')
    expect(text).toContain('Boards: 5 of 1.')
  })

  it('enforced: says what is paused now and how to restore it', async () => {
    const text = visibleText(await render(PlanLimitsEmail({ ...base, kind: 'enforced' })))
    expect(text).toContain('Plan limits now apply')
    expect(text).toContain('Webhooks, Custom domain are paused.')
    expect(text).toContain('is restored')
    expect(text).toContain('Restore what is paused')
  })

  it('titles a single thing in the singular', () => {
    expect(planLimitsTitle('start', 1, '25 Nov')).toBe('Fix 1 thing by 25 Nov')
  })
})

describe('PlanLimitsEmail mail class', () => {
  it('is not metered, so it never counts against the monthly email cap', () => {
    expect(EMAIL_BILLABLE.PlanLimitsEmail).toBe(false)
    expect(isEmailBillable('PlanLimitsEmail')).toBe(false)
    expect((METERED_EMAIL_TYPES as readonly string[]).includes('PlanLimitsEmail')).toBe(false)
  })

  it('sends under the workspace provider tenant, like the other attention mail', () => {
    expect(EMAIL_TENANTED.PlanLimitsEmail).toBe(true)
    expect(isTenantedEmailType('PlanLimitsEmail')).toBe(true)
  })
})
