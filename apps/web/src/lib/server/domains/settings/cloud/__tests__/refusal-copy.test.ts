/**
 * Exhaustive copy check over ENTITLEMENT_KEYS x PLAN_IDS.
 *
 * The upsell string is the one artefact this whole layer exists to produce, so
 * it gets asserted in full rather than by substring. An earlier version of this
 * suite checked `toContain(friendly)` and `toContain(planName)` per key, and
 * exact strings only for Pro and Business — which is precisely why it shipped
 * "Custom domains is a Enterprise feature" without a single red test. A
 * substring assertion cannot see a wrong verb or a wrong article, because both
 * live in the gaps between the substrings it checks.
 */
import { describe, expect, it } from 'vitest'
import {
  DISABLED_CLOUD_CONFIG,
  ENTITLEMENTS,
  ENTITLEMENT_KEYS,
  PLAN_CATALOGUE,
  PLAN_IDS,
  minimumPlanFor,
  type CloudConfig,
  type EntitlementKey,
  type PlanId,
} from '../cloud.types'
import { buildRefusal, isEntitled } from '../entitlements'

function cloud(plan: PlanId | null, overrides: Partial<CloudConfig> = {}): CloudConfig {
  return { ...DISABLED_CLOUD_CONFIG, enabled: true, plan, ...overrides }
}

/** Independently reconstructed expectation — not a call into the code under test. */
function expectedMessage(key: EntitlementKey, plan: PlanId | null): string {
  const definition = ENTITLEMENTS[key]
  const verb = definition.plural ? 'are' : 'is'
  const current = plan ? PLAN_CATALOGUE[plan] : null
  const cheapest = minimumPlanFor(key)
  const required = cheapest && current && cheapest.rank <= current.rank ? null : cheapest
  const on = current ? ` Your workspace is on ${current.name}.` : ''
  if (!required) {
    return `${definition.friendly} ${verb} not included in your plan.${on} Contact us to enable it.`
  }
  return `${definition.friendly} ${verb} ${required.article} ${required.name} feature.${on} Upgrade to ${required.name} to enable it.`
}

// Every (entitlement, plan) pair where the plan does not grant the entitlement,
// plus the no-plan case. Denials are forced with an override so that pairs the
// plan *does* grant still produce a refusal to inspect.
const cases: Array<[EntitlementKey, PlanId | null]> = []
for (const key of ENTITLEMENT_KEYS) {
  for (const plan of [...PLAN_IDS, null]) cases.push([key, plan])
}

describe('refusal copy, every entitlement against every plan', () => {
  it.each(cases)('%s on plan %s reads correctly', (key, plan) => {
    const config = cloud(plan, { entitlements: { [key]: false } })
    // Sanity: the config under test really does deny, so the message is a
    // refusal the product would actually emit and not a hypothetical.
    expect(isEntitled(config, key)).toBe(false)
    expect(buildRefusal(config, key).message).toBe(expectedMessage(key, plan))
  })
})

describe('the defects that shipped', () => {
  it.each([
    ['customDomain', 'Custom domains are '],
    ['webhooks', 'Webhooks are '],
    ['workflows', 'Workflows are '],
    ['aiInsights', 'AI insights are '],
    ['aiDrafts', 'AI drafts are '],
    ['sso', 'Single sign-on is '],
    ['apiAccess', 'API access is '],
    ['auditLog', 'The audit log is '],
    ['aiAssistant', 'The AI assistant is '],
    ['mcpServer', 'The MCP server is '],
  ] as Array<[EntitlementKey, string]>)('%s agrees subject and verb', (key, opening) => {
    expect(buildRefusal(cloud('free'), key).message.slice(0, opening.length)).toBe(opening)
  })

  it('takes the article from the plan it names', () => {
    // Pins that the copy carries an article and the right plan. Enterprise is
    // today's `an` case; the loop below is the invariant that survives a rename.
    expect(buildRefusal(cloud('free'), 'sso').message).toContain('an Enterprise feature')
    expect(buildRefusal(cloud('free'), 'customDomain').message).toContain('a Pro feature')
    expect(buildRefusal(cloud('free'), 'auditLog').message).toContain('an Enterprise feature')
  })

  it('never emits "a" before a vowel-initial plan name or vice versa', () => {
    // Catches a future plan named e.g. "Advanced" or "Individual" being added
    // with the wrong article, without hardcoding today's four names.
    for (const plan of Object.values(PLAN_CATALOGUE)) {
      const startsWithVowel = /^[AEIOU]/.test(plan.name)
      // The two exceptions this field exists for ("Unlimited", "One") are not
      // in the catalogue today; if one is added, relax this with a comment
      // rather than silently flipping the article.
      expect(plan.article).toBe(startsWithVowel ? 'an' : 'a')
    }
  })

  it('agrees verb in the no-upgrade-available branch too', () => {
    // The "contact us" branch has its own copy path and was equally broken.
    const config = cloud('enterprise', { entitlements: { customDomain: false } })
    expect(buildRefusal(config, 'customDomain').message).toBe(
      'Custom domains are not included in your plan. Your workspace is on Enterprise. Contact us to enable it.'
    )
  })
})

describe('the catalogue declares copy metadata for every entry', () => {
  it.each(ENTITLEMENT_KEYS)('%s declares plural', (key) => {
    expect(typeof ENTITLEMENTS[key].plural).toBe('boolean')
  })

  it.each(PLAN_IDS)('%s declares an article', (plan) => {
    expect(['a', 'an']).toContain(PLAN_CATALOGUE[plan].article)
  })
})
