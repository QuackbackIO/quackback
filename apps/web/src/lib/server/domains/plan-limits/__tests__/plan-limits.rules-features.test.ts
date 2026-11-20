/**
 * Paid features in the rules: a feature set up past the plan is an issue only
 * when it could have run, that is the plan before the drop included it (read
 * from `previous`, or from the grace already stored for these limits). Caps
 * are judged on usage alone.
 */
import { describe, expect, it } from 'vitest'
import { OSS_TIER_LIMITS, type TierLimits } from '@/lib/server/domains/settings/tier-limits.types'
import {
  DISABLED_CLOUD_CONFIG,
  type CloudConfig,
} from '@/lib/server/domains/settings/cloud/cloud.types'
import { planFeatureSet } from '../plan-limits.features'
import { computePlanLimits, type PlanLimitsInputs } from '../plan-limits.rules'

const NOW = new Date('2026-11-18T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000

const FREE_LIMITS: TierLimits = {
  ...OSS_TIER_LIMITS,
  maxBoards: 1,
  features: {
    ...OSS_TIER_LIMITS.features,
    customDomain: false,
    customOidcProvider: false,
    webhooks: false,
    mcpServer: false,
    customCss: false,
    integrations: false,
  },
}
const FREE_CONFIG: CloudConfig = {
  ...DISABLED_CLOUD_CONFIG,
  enabled: true,
  plan: 'free',
  entitlements: { aiDrafts: true, apiAccess: true },
}
const PRO_CONFIG: CloudConfig = {
  ...FREE_CONFIG,
  plan: 'pro',
  entitlements: { ...FREE_CONFIG.entitlements, aiAssistant: true, webhooks: true },
}
const FREE_FEATURES = planFeatureSet(FREE_LIMITS.features, FREE_CONFIG)
// Pro has webhooks and the assistant, but no custom CSS.
const PRO = {
  plan: 'pro' as const,
  features: planFeatureSet({ ...FREE_LIMITS.features, webhooks: true }, PRO_CONFIG),
}

function inputs(over: Partial<PlanLimitsInputs> = {}): PlanLimitsInputs {
  return {
    enabled: true,
    plan: 'free',
    limits: FREE_LIMITS,
    features: FREE_FEATURES,
    usage: { maxBoards: 1 },
    configured: {},
    stored: null,
    previous: null,
    candidates: {},
    ...over,
  }
}

describe('computePlanLimits: paid features that could have run', () => {
  it('raises nothing for a feature set up on a plan that never had it', () => {
    const result = computePlanLimits(inputs({ configured: { aiAssistant: 1, webhooks: 2 } }), NOW)
    expect(result.view.featureIssues).toEqual([])
    expect(result.view.phase).toBe('ok')
    expect(result.nextState).toBeNull()
  })

  it('raises an issue and a grace for a feature the plan before included', () => {
    const result = computePlanLimits(
      inputs({ previous: PRO, configured: { aiAssistant: 1, webhooks: 2, customCss: 1 } }),
      NOW
    )
    // Custom CSS was not on the plan before either: it never ran, so no issue.
    expect(result.view.featureIssues).toEqual([
      { key: 'webhooks', count: 2 },
      { key: 'aiAssistant', count: 1 },
    ])
    expect(result.view.phase).toBe('grace')
    expect(result.nextState?.fromFeatures).toMatchObject({ aiAssistant: true, webhooks: true })
  })

  it('keeps the issue on later reads that no longer know the plan before, from the stored grace', () => {
    const first = computePlanLimits(inputs({ previous: PRO, configured: { aiAssistant: 1 } }), NOW)
    const later = computePlanLimits(
      inputs({ stored: first.nextState, configured: { aiAssistant: 1 } }),
      new Date(NOW.getTime() + DAY)
    )
    expect(later.view.featureIssues).toEqual([{ key: 'aiAssistant', count: 1 }])
    expect(later.view.phase).toBe('grace')
    expect(later.view.since).toBe(NOW.toISOString())
    const after = computePlanLimits(
      inputs({ stored: first.nextState, configured: { aiAssistant: 1 } }),
      new Date(NOW.getTime() + 8 * DAY)
    )
    expect(after.view.phase).toBe('enforced')
  })

  it('never carries a feature into the grace that the plan before did not have', () => {
    const result = computePlanLimits(
      inputs({ usage: { maxBoards: 3 }, configured: { aiAssistant: 1, webhooks: 1 } }),
      NOW
    )
    expect(result.view.phase).toBe('grace')
    expect(result.view.featureIssues).toEqual([])
    expect(result.nextState?.fromFeatures).toMatchObject({ aiAssistant: false, webhooks: false })
  })

  it('judges caps on usage alone, whatever the plan before', () => {
    const result = computePlanLimits(inputs({ usage: { maxBoards: 3 } }), NOW)
    expect(result.view.issues.map((issue) => issue.key)).toEqual(['maxBoards'])
    expect(result.view.phase).toBe('grace')
  })
})
