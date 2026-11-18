/**
 * The one-line paused notice on a paid feature's settings page: shown only
 * while that feature, set up past the plan, is in the plan limits grace or
 * paused after it.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/server/functions/plan-limits', () => ({ getPlanLimitsFn: vi.fn() }))

import { planFeatureNotice, type PlanNoticeState } from '../plan-feature-notice-body'
import { formatFirstRenderDate } from '@/components/ui/local-date'

const state = (over: Partial<PlanNoticeState> = {}): PlanNoticeState => ({
  enabled: true,
  phase: 'enforced',
  planName: 'Free',
  graceEndsAt: '2026-11-25T12:00:00.000Z',
  deadlineDay: '2026-11-24',
  featureIssues: [{ key: 'workflows' }],
  canManageBilling: true,
  ...over,
})

const NOW = new Date('2026-11-18T09:00:00.000Z')
const usFormat = (date: unknown, options?: Intl.DateTimeFormatOptions) =>
  formatFirstRenderDate(date as string, options, 'en-US')
const gbFormat = (date: unknown, options?: Intl.DateTimeFormatOptions) =>
  formatFirstRenderDate(date as string, options, 'en-GB')

describe('planFeatureNotice', () => {
  it('says the feature is paused on the plan and comes back on upgrade', () => {
    expect(planFeatureNotice('workflows', state(), usFormat, NOW)).toEqual({
      text: 'Workflows are paused on the Free plan. They come back when you upgrade. Runs that were waiting have stopped.',
      showPlans: true,
    })
  })

  it('names the last day before it pauses, in the viewer locale, with no weekday', () => {
    expect(planFeatureNotice('workflows', state({ phase: 'grace' }), usFormat, NOW)?.text).toBe(
      'Workflows pause after Nov 24. Runs waiting at that point stop.'
    )
    expect(planFeatureNotice('workflows', state({ phase: 'grace' }), gbFormat, NOW)?.text).toBe(
      'Workflows pause after 24 Nov. Runs waiting at that point stop.'
    )
    expect(
      planFeatureNotice(
        'webhooks',
        state({ phase: 'grace', featureIssues: [{ key: 'webhooks' }] }),
        usFormat,
        NOW
      )?.text
    ).toBe('Webhooks pause after Nov 24.')
  })

  it('adds the year only when the day is in another year', () => {
    const graceEndsAt = '2027-01-02T12:00:00.000Z'
    const deadlineDay = '2027-01-01'
    expect(
      planFeatureNotice(
        'customCss',
        state({ phase: 'grace', graceEndsAt, deadlineDay, featureIssues: [{ key: 'customCss' }] }),
        usFormat,
        NOW
      )?.text
    ).toBe('Custom CSS pauses after Jan 1, 2027.')
  })

  it('never says "the current plan" when the plan has no name', () => {
    expect(
      planFeatureNotice(
        'customCss',
        state({ planName: null, featureIssues: [{ key: 'customCss' }] }),
        usFormat,
        NOW
      )?.text
    ).toBe('Custom CSS is paused. It comes back when you upgrade.')
  })

  it('offers Upgrade only to billing managers', () => {
    expect(planFeatureNotice('workflows', state({ canManageBilling: false }))?.showPlans).toBe(
      false
    )
  })

  it.each([
    ['the flag is off', state({ enabled: false })],
    ['nothing is over the plan', state({ phase: 'ok' })],
    ['this feature is not set up past the plan', state({ featureIssues: [{ key: 'webhooks' }] })],
    ['the state has not loaded', undefined],
  ])('shows nothing when %s', (_label, value) => {
    expect(planFeatureNotice('workflows', value)).toBeNull()
  })

  it.each([
    ['webhooks', 'Webhooks are paused on the Free plan. They come back when you upgrade.'],
    ['integrations', 'Integrations are paused on the Free plan. They come back when you upgrade.'],
    [
      'customDomain',
      'Your custom domain is paused on the Free plan. It comes back when you upgrade.',
    ],
    ['customCss', 'Custom CSS is paused on the Free plan. It comes back when you upgrade.'],
    [
      'aiAssistant',
      'The AI assistant is paused on the Free plan. It comes back when you upgrade. Conversations go to your team.',
    ],
    [
      'aiArticleTranslation',
      'AI article translation is paused on the Free plan. It comes back when you upgrade. Published translations stay.',
    ],
  ] as const)('has its own sentence for %s', (feature, text) => {
    expect(
      planFeatureNotice(feature, state({ featureIssues: [{ key: feature }] }), usFormat, NOW)?.text
    ).toBe(text)
  })
})
