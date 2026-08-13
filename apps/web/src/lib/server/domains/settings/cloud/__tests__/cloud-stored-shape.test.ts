/**
 * Drift tripwire between `CloudConfig` (here) and `StoredCloudConfig`
 * (packages/db `schema/auth.ts`). packages/db cannot import apps/web, so the
 * stored shape is hand-written and the two must be reconciled by hand. Same
 * pattern as the assistant-config twins in
 * `lib/shared/assistant/__tests__/config.test.ts`.
 *
 * The stored twin is deliberately looser than the resolved one — it widens the
 * `PlanId` union to `string`, allows an arbitrary entitlement map, and makes
 * every field but `enabled` optional, because a stored row may have been
 * written by an older or newer writer. So the assertion is *assignability in
 * the direction that matters*: anything this code writes must be storable, and
 * anything storable must be something `resolveCloudConfig` can consume.
 */
import { describe, expect, it } from 'vitest'
import type { StoredCloudConfig } from '@/lib/shared/db-types'
import { resolveCloudConfig } from '../cloud.service'
import { mergeCloudConfig } from '../cloud.merge'
import {
  BILLING_STATUSES,
  ENTITLEMENT_KEYS,
  PLAN_IDS,
  type BillingStatus,
  type PlanId,
} from '../cloud.types'

type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false
type Expect<T extends true> = T

// The writer's output type must be exactly the stored type — if a field is
// added on one side and not the other, this stops compiling.
type _WriterProducesStoredShape = Expect<
  Equal<ReturnType<typeof mergeCloudConfig>, StoredCloudConfig>
>
const _writerProducesStoredShape: _WriterProducesStoredShape = true

// The reader must accept the stored type verbatim.
type _ReaderConsumesStoredShape = Expect<
  Equal<Parameters<typeof resolveCloudConfig>[0], StoredCloudConfig | null | undefined>
>
const _readerConsumesStoredShape: _ReaderConsumesStoredShape = true

// The stored twin widens these on purpose; pin the widening so a future
// narrowing on the db side is a compile error rather than a silent runtime
// mismatch with a control plane on a different version.
type _PlanIsWidened = Expect<Equal<StoredCloudConfig['plan'], string | null | undefined>>
const _planIsWidened: _PlanIsWidened = true

describe('stored/resolved twins', () => {
  it('round-trips a fully populated block', () => {
    const stored = mergeCloudConfig(
      null,
      {
        enabled: true,
        plan: 'scale',
        entitlements: { sso: true, auditLog: false },
        billing: {
          provider: 'acme',
          customerRef: 'cus_1',
          subscriptionRef: 'sub_1',
          status: 'active',
          currentPeriodEnd: '2026-09-01T00:00:00.000Z',
        },
        upgradeUrl: 'https://example.com/billing',
      },
      { writer: 'billing', now: new Date('2026-08-08T00:00:00.000Z') }
    )
    const resolved = resolveCloudConfig(stored)
    expect(resolved).toEqual({
      enabled: true,
      plan: 'scale',
      entitlements: { sso: true, auditLog: false },
      billing: {
        provider: 'acme',
        customerRef: 'cus_1',
        subscriptionRef: 'sub_1',
        status: 'active',
        currentPeriodEnd: '2026-09-01T00:00:00.000Z',
      },
      trial: null,
      trialActive: false,
      source: 'billing',
      updatedAt: '2026-08-08T00:00:00.000Z',
      upgradeUrl: 'https://example.com/billing',
    })
  })

  it('round-trips a trial, and resolves the plan it lends', () => {
    // The writer's output must be storable and the reader must accept it back:
    // a trial that survives the merge but not the read (or the reverse) is a
    // workspace whose plan changes when nothing happened.
    const stored = mergeCloudConfig(
      null,
      {
        enabled: true,
        plan: 'free',
        trial: {
          plan: 'pro',
          startedAt: '2026-03-01T00:00:00.000Z',
          endsAt: '2026-03-15T00:00:00.000Z',
        },
      },
      { writer: 'billing', now: new Date('2026-03-01T00:00:00.000Z') }
    )
    expect(stored.trial).toEqual({
      plan: 'pro',
      startedAt: '2026-03-01T00:00:00.000Z',
      endsAt: '2026-03-15T00:00:00.000Z',
    })

    const during = resolveCloudConfig(stored, new Date('2026-03-10T00:00:00.000Z'))
    expect({ plan: during.plan, trialActive: during.trialActive }).toEqual({
      plan: 'pro',
      trialActive: true,
    })

    const after = resolveCloudConfig(stored, new Date('2026-03-20T00:00:00.000Z'))
    expect({ plan: after.plan, trialActive: after.trialActive, trial: after.trial }).toEqual({
      plan: 'free',
      trialActive: false,
      trial: stored.trial,
    })
  })

  it('drops values a newer writer produced that this version does not know', () => {
    // A control plane one release ahead can write a plan id or entitlement key
    // this code has never heard of. Carrying it through would let an unknown
    // key deny a feature; dropping it means the workspace falls back to what
    // this version does understand.
    const resolved = resolveCloudConfig({
      enabled: true,
      plan: 'platinum',
      entitlements: { sso: true, timeTravel: true } as Record<string, boolean>,
      billing: { status: 'refunding' },
    } as StoredCloudConfig)
    expect(resolved.plan).toBeNull()
    expect(resolved.entitlements).toEqual({ sso: true })
    expect(resolved.billing.status).toBeNull()
  })

  it('drops non-boolean entitlement values', () => {
    const resolved = resolveCloudConfig({
      enabled: true,
      plan: 'pro',
      entitlements: { sso: 'yes', auditLog: true } as unknown as Record<string, boolean>,
    })
    expect(resolved.entitlements).toEqual({ auditLog: true })
  })

  it('keeps the runtime catalogues and their types in step', () => {
    const planIds: PlanId[] = [...PLAN_IDS]
    const statuses: BillingStatus[] = [...BILLING_STATUSES]
    expect(planIds.length).toBeGreaterThan(0)
    expect(statuses.length).toBeGreaterThan(0)
    expect(new Set(ENTITLEMENT_KEYS).size).toBe(ENTITLEMENT_KEYS.length)
  })
})
