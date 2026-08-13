/**
 * A trial is a plan a workspace holds before it has bought anything.
 *
 * The property that makes it safe is that it **ends by expiring**, not by
 * anything happening: no job runs, no row is rewritten, and the stored block
 * is already in its post-trial state the whole time it is running. So the
 * only thing that can be wrong is the resolution rule, and that is what this
 * file pins.
 *
 * ## Two traps, both specific to time
 *
 * A test that reads the real clock cannot tell "the trial ended" from "the
 * trial never started" — both render as *not entitled*. And a fixture pinned
 * to a future date passes until that date arrives and then rots. Both are
 * avoided the same way: every case below passes an explicit `now`, and every
 * fixture date is **permanently in the past**, so an implementation that
 * consulted `Date.now()` fails the during-the-trial cases forever rather than
 * from some Tuesday onwards.
 */
import { describe, expect, it } from 'vitest'
import type { StoredCloudConfig } from '@/lib/shared/db-types'
import { resolveCloudConfig } from '../cloud.service'
import { mergeCloudConfig } from '../cloud.merge'
import { isEntitled } from '../entitlements'
import {
  ENTITLEMENT_KEYS,
  PLAN_CATALOGUE,
  type CloudConfig,
  type EntitlementKey,
  type PlanId,
} from '../cloud.types'

/**
 * Fixed points, all in the past. Nothing here is derived from the process
 * clock, so the pair of assertions "granted at DURING / denied at AFTER" is
 * unsatisfiable by any implementation that reads the real time.
 */
const STARTED = new Date('2026-03-01T00:00:00.000Z')
const ENDS = new Date('2026-03-15T00:00:00.000Z')
const DURING = new Date('2026-03-14T23:59:59.999Z')
const AT_THE_BOUNDARY = ENDS
const AFTER = new Date('2026-03-15T00:00:00.001Z')
const LONG_AFTER = new Date('2026-06-01T00:00:00.000Z')

const TRIAL: NonNullable<StoredCloudConfig['trial']> = {
  plan: 'pro',
  startedAt: STARTED.toISOString(),
  endsAt: ENDS.toISOString(),
}

/**
 * A row exactly as the writer leaves it: cloud on, stored plan Free, a trial
 * recorded beside it. The stored plan is Free the entire time the trial runs,
 * which is the whole design — expiry needs no write because the row already
 * says what happens next.
 */
function trialingRow(overrides: Partial<StoredCloudConfig> = {}): StoredCloudConfig {
  return {
    enabled: true,
    plan: 'free',
    entitlements: {},
    billing: {},
    trial: TRIAL,
    source: 'billing',
    updatedAt: STARTED.toISOString(),
    ...overrides,
  }
}

function entitlementsOf(config: CloudConfig): Record<EntitlementKey, boolean> {
  return Object.fromEntries(
    ENTITLEMENT_KEYS.map((key) => [key, isEntitled(config, key)])
  ) as Record<EntitlementKey, boolean>
}

/** What a plan grants, read from the live catalogue rather than restated. */
function grantsOf(plan: PlanId): Record<EntitlementKey, boolean> {
  return Object.fromEntries(
    ENTITLEMENT_KEYS.map((key) => [key, PLAN_CATALOGUE[plan].grants.includes(key)])
  ) as Record<EntitlementKey, boolean>
}

describe('inside the trial', () => {
  it('the workspace has the trial plan', () => {
    expect(resolveCloudConfig(trialingRow(), DURING).plan).toBe('pro')
  })

  it('it has exactly the trial plan’s entitlements', () => {
    // Iterates the live catalogue, so an entitlement added next year is
    // covered without anyone remembering to add a case here.
    expect(entitlementsOf(resolveCloudConfig(trialingRow(), DURING))).toEqual(grantsOf('pro'))
  })

  it('reports the trial as running, and reports its end', () => {
    const config = resolveCloudConfig(trialingRow(), DURING)
    expect(config.trialActive).toBe(true)
    expect(config.trial).toEqual(TRIAL)
  })
})

describe('past the trial end', () => {
  it('the SAME stored row resolves to Free', () => {
    // Same fixture, different clock. Nothing was written in between: that is
    // the claim.
    const row = trialingRow()
    expect(resolveCloudConfig(row, DURING).plan).toBe('pro')
    expect(resolveCloudConfig(row, AFTER).plan).toBe('free')
  })

  it('has Free’s entitlements and no more', () => {
    expect(entitlementsOf(resolveCloudConfig(trialingRow(), AFTER))).toEqual(grantsOf('free'))
  })

  it('ends at the instant it says, not a day either side', () => {
    expect(resolveCloudConfig(trialingRow(), AT_THE_BOUNDARY).trialActive).toBe(false)
    expect(resolveCloudConfig(trialingRow(), DURING).trialActive).toBe(true)
  })

  it('keeps the trial on record so support can see there was one', () => {
    const config = resolveCloudConfig(trialingRow(), LONG_AFTER)
    expect(config.trial).toEqual(TRIAL)
    expect(config.trialActive).toBe(false)
  })

  it('is decided by the clock it is given, never by the process clock', () => {
    // Both fixtures are in the past relative to any real run of this suite, so
    // a resolver reading `Date.now()` would answer "ended" to both and could
    // not satisfy this pair. It cannot rot into passing later, either.
    expect(resolveCloudConfig(trialingRow(), DURING).plan).toBe('pro')
    expect(resolveCloudConfig(trialingRow(), AFTER).plan).toBe('free')
  })
})

describe('a workspace that has actually paid', () => {
  const paid = trialingRow({
    plan: 'pro',
    billing: {
      provider: 'acme',
      customerRef: 'cus_1',
      subscriptionRef: 'sub_1',
      status: 'active',
      currentPeriodEnd: '2027-01-01T00:00:00.000Z',
    },
  })

  it('is on its own plan while the trial date is still in the future', () => {
    expect(resolveCloudConfig(paid, DURING).plan).toBe('pro')
    expect(resolveCloudConfig(paid, DURING).trialActive).toBe(false)
  })

  it('is completely unaffected when that date passes', () => {
    expect(entitlementsOf(resolveCloudConfig(paid, DURING))).toEqual(
      entitlementsOf(resolveCloudConfig(paid, AFTER))
    )
    expect(resolveCloudConfig(paid, AFTER).plan).toBe('pro')
  })

  it('is on what it bought even when the trial plan is a bigger one', () => {
    // The discriminating case for "a subscription ends the trial". A workspace
    // that bought Growth while a Pro trial record was still in date must be on
    // Growth: the purchase is the answer, and a leftover record must not keep
    // handing out more than was paid for.
    const boughtSomethingSmaller = trialingRow({
      plan: 'growth',
      billing: { provider: 'acme', customerRef: 'cus_1', subscriptionRef: 'sub_1' },
    })
    expect(resolveCloudConfig(boughtSomethingSmaller, DURING).plan).toBe('growth')
    expect(entitlementsOf(resolveCloudConfig(boughtSomethingSmaller, DURING))).toEqual(
      grantsOf('growth')
    )
  })

  it('is never downgraded by a trial for a smaller plan than the one it bought', () => {
    // A trial can only ever add. Without that rule, a workspace on Scale with
    // a stale Pro trial record would lose SSO and the audit log for a
    // fortnight.
    const scale = trialingRow({ plan: 'scale' })
    expect(resolveCloudConfig(scale, DURING).plan).toBe('scale')
    expect(entitlementsOf(resolveCloudConfig(scale, DURING))).toEqual(grantsOf('scale'))
  })
})

describe('cloud off', () => {
  // The dangerous shape: a stored row carrying a trial on an install that
  // never opted in. Every entitlement must still be granted, and no countdown
  // may exist to render.
  const selfHosted = trialingRow({ enabled: false })

  it.each(ENTITLEMENT_KEYS)('%s is granted during the trial window', (key) => {
    expect(isEntitled(resolveCloudConfig(selfHosted, DURING), key)).toBe(true)
  })

  it.each(ENTITLEMENT_KEYS)('%s is still granted long after it', (key) => {
    expect(isEntitled(resolveCloudConfig(selfHosted, LONG_AFTER), key)).toBe(true)
  })

  it('has no plan, no trial and no countdown at any point in time', () => {
    for (const now of [STARTED, DURING, AFTER, LONG_AFTER]) {
      const config = resolveCloudConfig(selfHosted, now)
      expect({
        plan: config.plan,
        trial: config.trial,
        trialActive: config.trialActive,
      }).toEqual({ plan: null, trial: null, trialActive: false })
    }
  })
})

describe('a malformed trial record cannot gate or grant by accident', () => {
  const cases: Array<[string, unknown]> = [
    ['no end date', { plan: 'pro', startedAt: STARTED.toISOString() }],
    ['an unparseable end date', { ...TRIAL, endsAt: 'soon' }],
    ['a plan this version has never heard of', { ...TRIAL, plan: 'platinum' }],
    ['not an object at all', 'pro'],
    ['null', null],
  ]

  it.each(cases)('%s resolves to no trial and the stored plan', (_label, trial) => {
    const config = resolveCloudConfig(
      trialingRow({ trial: trial as StoredCloudConfig['trial'] }),
      DURING
    )
    expect({ trial: config.trial, trialActive: config.trialActive, plan: config.plan }).toEqual({
      trial: null,
      trialActive: false,
      plan: 'free',
    })
  })
})

describe('the other writer cannot erase a trial', () => {
  // `mergeCloudConfig` builds its output field by field, so a field it does
  // not name is dropped rather than carried. That makes "the config file
  // reconciles a plan" and "the trial disappears" the same event, silently,
  // 30 seconds after the trial starts.
  const stored = trialingRow()

  it('survives a config-file write that declares only the plan', () => {
    const merged = mergeCloudConfig(stored, { plan: 'free' }, { writer: 'config', now: DURING })
    expect(merged.trial).toEqual(TRIAL)
    expect(resolveCloudConfig(merged, DURING).plan).toBe('pro')
  })

  it('survives a billing write that records a customer reference', () => {
    const merged = mergeCloudConfig(
      stored,
      { billing: { provider: 'acme', customerRef: 'cus_1' } },
      { writer: 'billing', now: DURING }
    )
    expect(merged.trial).toEqual(TRIAL)
  })

  it('survives the empty-subscription write the reconcile sweep performs', () => {
    // `applySubscription(null, …)` is run by the 15-minute sweep for every
    // workspace with no subscription, which is every trialing workspace. If it
    // cleared the trial, no trial would outlive its first quarter hour.
    const merged = mergeCloudConfig(
      stored,
      {
        enabled: true,
        plan: 'free',
        billing: { provider: 'acme', subscriptionRef: null, status: null, currentPeriodEnd: null },
      },
      { writer: 'billing', now: DURING }
    )
    expect(merged.trial).toEqual(TRIAL)
    expect(resolveCloudConfig(merged, DURING).plan).toBe('pro')
  })

  it('is left absent on a row that never had one', () => {
    // No `"trial": null` noise in every row on every install.
    const merged = mergeCloudConfig(
      null,
      { enabled: true, plan: 'pro' },
      { writer: 'config', now: DURING }
    )
    expect('trial' in merged).toBe(false)
  })
})
