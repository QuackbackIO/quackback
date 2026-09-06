/**
 * The plan catalogue is the published price list, expressed in code.
 *
 * Two separate things are pinned here, and they need each other:
 *
 *  1. **Identity.** Which plan ids exist, in which order, under which names.
 *     Ranks matter more than they look: `pro` names the second plan, not the
 *     first, and a stored plan is just a string, so an id that slides up or
 *     down the ladder silently changes what a workspace gets.
 *  2. **Levels.** Which plan each entitlement first becomes available on. The
 *     expectation is transcribed from the price list by hand rather than read
 *     out of {@link PLAN_CATALOGUE}, because an expectation derived from the
 *     thing under test agrees with any catalogue, right or wrong.
 *
 * Every level assertion sweeps the whole ladder in both directions: refused on
 * every cheaper plan, granted on that plan and every dearer one. One direction
 * alone cannot tell a correct catalogue from one that grants everything, and
 * `isEntitled()` really does grant everything in one common configuration
 * (cloud off), which the fixture guard below makes explicit.
 */
import { describe, expect, it } from 'vitest'
import {
  DISABLED_CLOUD_CONFIG,
  ENTITLEMENT_KEYS,
  PLAN_CATALOGUE,
  PLAN_DEFINITIONS,
  PLAN_ID_ALIASES,
  PLAN_IDS,
  canonicalPlanId,
  isPlanId,
  minimumPlanFor,
  type CloudConfig,
  type EntitlementKey,
  type PlanId,
} from '../cloud.types'
import { isEntitled } from '../entitlements'

/** A workspace with gating switched on, on `plan`. */
function on(plan: PlanId): CloudConfig {
  const grants = new Set(PLAN_CATALOGUE[plan].grants)
  return {
    ...DISABLED_CLOUD_CONFIG,
    enabled: true,
    plan,
    entitlements: Object.fromEntries(ENTITLEMENT_KEYS.map((key) => [key, grants.has(key)])),
  }
}

/**
 * The cheapest plan each entitlement is included on. Hand-transcribed from the
 * price list; not derived from the catalogue under test.
 */
const INCLUDED_FROM: Partial<Record<EntitlementKey, PlanId>> = {
  customDomain: 'pro',
  aiAssistant: 'pro',
  aiDrafts: 'pro',
  apiAccess: 'pro',
  mcpServer: 'pro',
  webhooks: 'pro',
  aiInsights: 'pro',
  workflows: 'business',
  auditLog: 'enterprise',
  sso: 'enterprise',
}

const ADD_ON_KEYS: EntitlementKey[] = ['hideBranding']

describe('the plan ladder', () => {
  it('is the four plans the product sells, cheapest first', () => {
    expect(PLAN_IDS).toEqual(['free', 'pro', 'business', 'enterprise'])
  })

  it('ranks each id at its position in the ladder', () => {
    // Pinned as pairs rather than as a set. `business` sitting at rank 2 is the
    // whole point: a stored plan is a bare string, so an id that keeps its
    // name but changes rank hands a workspace a tier it never bought.
    expect(PLAN_DEFINITIONS.map((plan) => [plan.id, plan.rank])).toEqual([
      ['free', 0],
      ['pro', 1],
      ['business', 2],
      ['enterprise', 3],
    ])
  })

  it('reads correctly in refusal copy, article and all', () => {
    expect(
      PLAN_IDS.map((id) => `${PLAN_CATALOGUE[id].article} ${PLAN_CATALOGUE[id].name} plan`)
    ).toEqual(['a Free plan', 'a Pro plan', 'a Business plan', 'an Enterprise plan'])
  })

  it('maps leftover growth/scale onto pro/enterprise; pro is the entry tier', () => {
    expect(PLAN_ID_ALIASES).toEqual({ growth: 'pro', scale: 'enterprise' })
    expect(canonicalPlanId('pro')).toBe('pro')
    expect(canonicalPlanId('growth')).toBe('pro')
    expect(canonicalPlanId('scale')).toBe('enterprise')
    expect(canonicalPlanId('business')).toBe('business')
    expect(canonicalPlanId('enterprise')).toBe('enterprise')
    expect(isPlanId('pro')).toBe(true)
    expect(isPlanId('growth')).toBe(false)
    expect(isPlanId('scale')).toBe(false)
    expect(isPlanId('business')).toBe(true)
    expect(isPlanId('enterprise')).toBe(true)
    expect(PLAN_CATALOGUE[canonicalPlanId('growth')]).toEqual(PLAN_CATALOGUE.pro)
    expect(PLAN_CATALOGUE[canonicalPlanId('scale')]).toEqual(PLAN_CATALOGUE.enterprise)
    expect(PLAN_CATALOGUE[canonicalPlanId('pro')].name).toBe('Pro')
    expect(PLAN_CATALOGUE.business.name).toBe('Business')
    expect(PLAN_CATALOGUE[canonicalPlanId('scale')]).toMatchObject({
      name: 'Enterprise',
      article: 'an',
      rank: PLAN_CATALOGUE.enterprise.rank,
      grants: PLAN_CATALOGUE.enterprise.grants,
    })
  })
})

describe('what each plan includes', () => {
  it('states a level for every entitlement in the catalogue', () => {
    // Keeps this file exhaustive: a key added without a considered level
    // fails here rather than shipping at whatever level it landed on.
    expect(Object.keys(INCLUDED_FROM).sort()).toEqual(
      ENTITLEMENT_KEYS.filter((key) => !ADD_ON_KEYS.includes(key)).sort()
    )
  })

  it.each(Object.entries(INCLUDED_FROM) as Array<[EntitlementKey, PlanId]>)(
    '%s is included from %s up, and refused below it',
    (key, from) => {
      const threshold = PLAN_CATALOGUE[from].rank
      // The whole ladder, both directions, in one comparison so a failure
      // names the plan that disagreed.
      expect(PLAN_DEFINITIONS.map((plan) => [plan.id, isEntitled(on(plan.id), key)])).toEqual(
        PLAN_DEFINITIONS.map((plan) => [plan.id, plan.rank >= threshold])
      )
    }
  )

  it.each(Object.entries(INCLUDED_FROM) as Array<[EntitlementKey, PlanId]>)(
    'a refusal of %s names %s as the upgrade',
    (key, from) => {
      expect(minimumPlanFor(key)?.id).toBe(from)
    }
  )

  it('gates at all: the same fixture with cloud off grants everything', () => {
    // The trap this guards. `isEntitled()` short-circuits to true when cloud
    // is disabled, which is every self-hosted install, so a fixture that
    // forgot `enabled: true` would pass every assertion above against any
    // catalogue whatsoever, including an empty one.
    for (const key of ENTITLEMENT_KEYS) {
      expect({ key, off: isEntitled({ ...on('free'), enabled: false }, key) }).toEqual({
        key,
        off: true,
      })
      expect({ key, free: isEntitled(on('free'), key) }).toEqual({ key, free: false })
    }
  })
})

describe('the levels the price list moved', () => {
  // One test per correction. Each states the level it moved FROM as well as
  // the one it moved to, so a catalogue that simply granted more would fail.

  it('includes the MCP server from Pro, the cheapest paid plan', () => {
    expect(isEntitled(on('free'), 'mcpServer')).toBe(false)
    expect(isEntitled(on('pro'), 'mcpServer')).toBe(true)
  })

  it('includes AI insights from Pro, the cheapest paid plan', () => {
    expect(isEntitled(on('free'), 'aiInsights')).toBe(false)
    expect(isEntitled(on('pro'), 'aiInsights')).toBe(true)
  })

  it('starts workflows at Business, not at Pro', () => {
    expect(isEntitled(on('pro'), 'workflows')).toBe(false)
    expect(isEntitled(on('business'), 'workflows')).toBe(true)
  })

  it('starts the audit log at Enterprise, not at Business', () => {
    expect(isEntitled(on('business'), 'auditLog')).toBe(false)
    expect(isEntitled(on('enterprise'), 'auditLog')).toBe(true)
  })

  it('includes drafting and insights together on every paid plan', () => {
    expect(isEntitled(on('pro'), 'aiDrafts')).toBe(true)
    expect(isEntitled(on('pro'), 'aiInsights')).toBe(true)
    expect(isEntitled(on('business'), 'aiDrafts')).toBe(true)
    expect(isEntitled(on('business'), 'aiInsights')).toBe(true)
  })

  it('never grants hideBranding from a plan; it is a purchased overlay', () => {
    for (const plan of PLAN_DEFINITIONS) {
      expect(isEntitled(on(plan.id), 'hideBranding')).toBe(false)
    }
    expect(minimumPlanFor('hideBranding')).toBeNull()
  })
})
