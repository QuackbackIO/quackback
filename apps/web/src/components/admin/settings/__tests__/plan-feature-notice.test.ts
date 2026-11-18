/**
 * The one-line paused notice on a paid feature's settings page: shown only
 * while that feature, set up past the plan, is in the plan limits grace or
 * paused after it.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/server/functions/plan-limits', () => ({ getPlanLimitsFn: vi.fn() }))

import { planFeatureNotice, type PlanNoticeState } from '../plan-feature-notice'

const state = (over: Partial<PlanNoticeState> = {}): PlanNoticeState => ({
  enabled: true,
  phase: 'enforced',
  planName: 'Free',
  graceEndsAt: '2026-11-25T12:00:00.000Z',
  featureIssues: [{ key: 'workflows' }],
  canManageBilling: true,
  ...over,
})

describe('planFeatureNotice', () => {
  it('says the feature is paused and kept after the grace', () => {
    expect(planFeatureNotice('workflows', state())).toEqual({
      text: "Workflows are paused on the Free plan. They're kept and start again when you upgrade.",
      showPlans: true,
    })
  })

  it('names the day it pauses during the grace', () => {
    expect(planFeatureNotice('workflows', state({ phase: 'grace' }))?.text).toBe(
      'Workflows pause on 25 Nov unless you choose a plan.'
    )
  })

  it('links to plans only for billing managers', () => {
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
    [
      'webhooks',
      "Webhooks are paused on the Free plan. They're kept and start again when you upgrade.",
    ],
    [
      'integrations',
      'Integrations are paused on the Free plan. They stay connected and start again when you upgrade.',
    ],
    [
      'customDomain',
      "Your custom domain is paused on the Free plan. It's kept and serves again when you upgrade.",
    ],
    [
      'customCss',
      "Custom CSS is paused on the Free plan. It's kept and applies again when you upgrade.",
    ],
    [
      'aiAssistant',
      'The AI assistant is paused on the Free plan. Conversations go to your team. It answers again when you upgrade.',
    ],
    [
      'aiArticleTranslation',
      'AI article translation is paused on the Free plan. Published translations stay, and it starts again when you upgrade.',
    ],
  ] as const)('has its own sentence for %s', (feature, text) => {
    expect(planFeatureNotice(feature, state({ featureIssues: [{ key: feature }] }))?.text).toBe(
      text
    )
  })
})
