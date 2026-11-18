/**
 * The plan limits email: its three variants and their mail classes.
 */
import { describe, expect, it } from 'vitest'
import { render } from '@react-email/components'
import { PlanLimitsEmail, featureList, planLimitsSubject } from '../templates/plan-limits'
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
  deadline: 'Nov 24',
  deadlineHeading: 'Tue, Nov 24',
  rows: [
    { label: 'Boards', used: 5, cap: 1, effect: '4 boards become read-only' },
    {
      label: 'Team seats',
      used: 3,
      cap: 1,
      effect: '2 teammates lose admin access until a seat frees up',
    },
  ],
  pausingFeatures: ['Webhooks', 'Custom domain'],
  limitsUrl: 'https://app.example.com/admin/settings/billing/limits',
  planUrl: 'https://app.example.com/admin/settings/billing',
}

const BANNED = /\b(grace|enforce|enforced|enforcement|frozen|extras|held)\b/i

describe('PlanLimitsEmail', () => {
  it('start: names the issues and the date, what pauses, and that nothing is deleted', async () => {
    const html = await render(PlanLimitsEmail({ ...base, kind: 'start' }))
    const text = visibleText(html)
    expect(text).toContain('Fix 2 issues by Tue, Nov 24')
    expect(text).toContain('Fix 2 issues by Nov 24, or upgrade to keep everything.')
    expect(text).toContain('Boards: 5 of 1. 4 boards become read-only.')
    expect(text).toContain(
      'Team seats: 3 of 1. 2 teammates lose admin access until a seat frees up.'
    )
    expect(text).toContain('Webhooks and your custom domain pause after Nov 24.')
    expect(text.match(/Nothing is deleted\./g)).toHaveLength(1)
    expect(text).toContain('Review issues')
    expect(text).toContain('Upgrade to Pro')
    expect(text).toContain("You're getting this because you manage billing for Acme Support.")
    expect(text).not.toMatch(BANNED)
    expect(html).toContain('href="https://app.example.com/admin/settings/billing/limits"')
    expect(html).toContain('href="https://app.example.com/admin/settings/billing"')
  })

  it('reminder: same content', async () => {
    const text = visibleText(await render(PlanLimitsEmail({ ...base, kind: 'reminder' })))
    expect(text).toContain('Fix 2 issues by Nov 24')
    expect(text).toContain('Boards: 5 of 1.')
    expect(text).not.toMatch(BANNED)
  })

  it('after the deadline: says what is paused and that it comes back on upgrade', async () => {
    const text = visibleText(await render(PlanLimitsEmail({ ...base, kind: 'enforced' })))
    expect(text).toContain('Some of Acme Support is now paused')
    expect(text).toContain('Webhooks and your custom domain are paused on the Free plan.')
    expect(text).toContain('Nothing is deleted. It comes back when you upgrade.')
    expect(text).toContain('Review issues')
    expect(text).not.toMatch(BANNED)
  })

  it('says features pause, not "Fix 0 issues", when no cap is over', async () => {
    const props = { ...base, rows: [], kind: 'start' as const }
    const text = visibleText(await render(PlanLimitsEmail(props)))
    expect(text).toContain('Some features pause after Tue, Nov 24')
    expect(text).toContain('Upgrade to keep everything.')
    expect(text).not.toMatch(/Fix \d+ issue/)
    expect(planLimitsSubject('start', 'Acme Support', 'Free', 'Nov 24')).toBe(
      'Acme Support: some features pause after Nov 24'
    )
  })

  it('falls back to Compare plans when the earlier plan is unknown', async () => {
    const text = visibleText(
      await render(PlanLimitsEmail({ ...base, kind: 'start', fromPlanName: null }))
    )
    expect(text).toContain('Compare plans')
  })

  it('lists one, two and three features as a sentence', () => {
    expect(featureList(['Webhooks'])).toBe('Webhooks')
    expect(featureList(['Webhooks', 'Custom domain'])).toBe('Webhooks and your custom domain')
    expect(featureList(['Webhooks', 'Workflows', 'Integrations'])).toBe(
      'Webhooks, workflows and integrations'
    )
    expect(featureList(['Workflows', 'AI assistant', 'Custom CSS'])).toBe(
      'Workflows, AI assistant and your custom CSS'
    )
    expect(featureList(['Custom domain'])).toBe('Your custom domain')
  })

  it('words the three subjects', () => {
    expect(planLimitsSubject('start', 'Acme Support', 'Free')).toBe(
      "Action needed: Acme Support is over the Free plan's limits"
    )
    expect(planLimitsSubject('reminder', 'Acme Support', 'Free')).toBe(
      "2 days left to fix Acme Support's plan limits"
    )
    expect(planLimitsSubject('enforced', 'Acme Support', 'Free')).toBe(
      'Some of Acme Support is now paused'
    )
  })

  it('names the workspace in every subject', () => {
    const subjects = (['start', 'reminder', 'enforced'] as const).flatMap((kind) => [
      planLimitsSubject(kind, 'Acme Support', 'Free'),
      planLimitsSubject(kind, 'Acme Support', 'Free', 'Nov 24'),
    ])
    for (const subject of subjects) expect(subject).toContain('Acme Support')
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
