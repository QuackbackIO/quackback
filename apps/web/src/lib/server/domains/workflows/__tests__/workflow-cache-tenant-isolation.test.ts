/**
 * The two live-workflow caches, across tenants.
 *
 * §4.2 lists `workflow.service.ts:232,328` as "live-workflow caches". Both are
 * read on the hot per-inbound-message path, and both hold an answer derived
 * from one workspace's `workflows` rows.
 *
 * The failure directions are asymmetric and the bad one is silent:
 *
 * - `hasAnyLiveWorkflow` shared **false** means a workspace with live workflows
 *   stops running them. The gate is read BEFORE the enqueue, so nothing
 *   dispatches, nothing errors, and there is no run row to notice is missing.
 * - `getLiveWorkflowReferencedAttributeKeys` shared means one workspace's
 *   attribute vocabulary decides what another re-classifies mid-conversation:
 *   its AI budget goes on keys its own workflows never branch on, while the
 *   keys they do branch on go stale.
 *
 * The database is stubbed per tenant so the two workspaces genuinely differ,
 * and the stub counts reads so the suite also proves the cache is still a cache
 * — a cache accidentally disabled would pass every isolation assertion here for
 * entirely the wrong reason.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

interface TenantRows {
  live: { graph: unknown }[]
}

const hoisted = vi.hoisted(() => ({
  rows: new Map<string, TenantRows>(),
  reads: [] as string[],
  currentTenantId: (): string => '',
}))

function rowsForTenant(): TenantRows {
  return hoisted.rows.get(hoisted.currentTenantId()) ?? { live: [] }
}

vi.mock('@/lib/server/db', () => {
  // `hasAnyLiveWorkflow` runs .select().from().where().limit();
  // `getLiveWorkflowReferencedAttributeKeys` runs .select().from().where().
  // One thenable serves both by resolving to the same row list.
  const result = () => {
    hoisted.reads.push(hoisted.currentTenantId())
    return rowsForTenant().live
  }
  const chain = {
    where: () => ({
      limit: async () => result(),
      then: (onFulfilled: (v: unknown) => unknown) => Promise.resolve(result()).then(onFulfilled),
    }),
  }
  return {
    db: { select: () => ({ from: () => chain }) },
    workflows: { id: 'id', status: 'status', deletedAt: 'deleted_at', graph: 'graph' },
    eq: () => null,
    and: () => null,
    isNull: () => null,
    inArray: () => null,
    asc: () => null,
  }
})

vi.mock('@/lib/server/utils', () => ({ positionCaseSql: () => null }))
vi.mock('../workflow-versions', () => ({
  writeWorkflowVersion: async () => undefined,
  workflowVersionFieldsChanged: () => false,
  pruneWorkflowVersions: async () => undefined,
}))

const {
  hasAnyLiveWorkflow,
  invalidateHasLiveWorkflowCache,
  getLiveWorkflowReferencedAttributeKeys,
  __resetLiveWorkflowReferencedAttributeKeysCache,
} = await import('../workflow.service')
const { withTenant } = await import('@/lib/server/__tests__/tenant-scope')
const { getCurrentTenant } = await import('@/lib/server/tenancy/tenant-context')

hoisted.currentTenantId = () => getCurrentTenant()?.tenantId ?? ''

/**
 * A graph whose one condition node branches on `conversation.attr.<key>`.
 *
 * The node shape is `{ type: 'condition', condition }`, which is what
 * `collectAttributeKeysFromGraph` reads. A first version of this fixture used a
 * plausible-looking `{ kind: 'branch', config: { condition } }` and produced an
 * empty key set — under which the negative case below ("does not hand an empty
 * workspace a neighbour's keys") passed happily, because nothing had any keys
 * to leak. The two positive cases caught it. That is why they are here.
 */
function graphReferencing(key: string): { graph: unknown } {
  return {
    graph: {
      nodes: [
        {
          id: 'n1',
          type: 'condition',
          condition: { field: `conversation.attr.${key}`, op: 'eq', value: 'x' },
        },
      ],
    },
  }
}

beforeEach(() => {
  hoisted.rows.clear()
  hoisted.reads.length = 0
  for (const id of ['tenant-alpha', 'tenant-bravo']) {
    withTenant(id, () => invalidateHasLiveWorkflowCache())
  }
  invalidateHasLiveWorkflowCache()
  __resetLiveWorkflowReferencedAttributeKeysCache()
})

describe('hasAnyLiveWorkflow', () => {
  it('does not let a workspace with none answer for a workspace with some', async () => {
    hoisted.rows.set('tenant-alpha', { live: [] })
    hoisted.rows.set('tenant-bravo', { live: [{ graph: {} }] })

    expect(await withTenant('tenant-alpha', () => hasAnyLiveWorkflow())).toBe(false)
    expect(await withTenant('tenant-bravo', () => hasAnyLiveWorkflow())).toBe(true)
  })

  it('does not let a workspace with some answer for a workspace with none', async () => {
    // Both directions: a shared cache leaks whichever tenant asked first, so a
    // one-directional check is satisfied by the ordering rather than the fix.
    hoisted.rows.set('tenant-alpha', { live: [{ graph: {} }] })
    hoisted.rows.set('tenant-bravo', { live: [] })

    expect(await withTenant('tenant-alpha', () => hasAnyLiveWorkflow())).toBe(true)
    expect(await withTenant('tenant-bravo', () => hasAnyLiveWorkflow())).toBe(false)
  })

  it('still caches within a tenant — one read for three calls', async () => {
    hoisted.rows.set('tenant-alpha', { live: [{ graph: {} }] })
    await withTenant('tenant-alpha', async () => {
      await hasAnyLiveWorkflow()
      await hasAnyLiveWorkflow()
      await hasAnyLiveWorkflow()
    })

    expect(hoisted.reads.filter((t) => t === 'tenant-alpha')).toHaveLength(1)
  })

  it('invalidation clears only the workspace that changed', async () => {
    hoisted.rows.set('tenant-alpha', { live: [] })
    hoisted.rows.set('tenant-bravo', { live: [{ graph: {} }] })
    await withTenant('tenant-alpha', () => hasAnyLiveWorkflow())
    await withTenant('tenant-bravo', () => hasAnyLiveWorkflow())
    hoisted.reads.length = 0

    hoisted.rows.set('tenant-alpha', { live: [{ graph: {} }] })
    withTenant('tenant-alpha', () => invalidateHasLiveWorkflowCache())

    expect(await withTenant('tenant-alpha', () => hasAnyLiveWorkflow())).toBe(true)
    expect(await withTenant('tenant-bravo', () => hasAnyLiveWorkflow())).toBe(true)
    // Only alpha re-read: one admin's click must not make the fleet re-query
    // the hottest path there is.
    expect(hoisted.reads).toEqual(['tenant-alpha'])
  })
})

describe('getLiveWorkflowReferencedAttributeKeys', () => {
  it('gives each workspace only the keys its own live workflows reference', async () => {
    hoisted.rows.set('tenant-alpha', { live: [graphReferencing('sentiment')] })
    hoisted.rows.set('tenant-bravo', { live: [graphReferencing('churn_risk')] })

    const alpha = await withTenant('tenant-alpha', () => getLiveWorkflowReferencedAttributeKeys())
    const bravo = await withTenant('tenant-bravo', () => getLiveWorkflowReferencedAttributeKeys())

    // The fixture reaches the branch: each side really did derive a key.
    expect([...alpha]).toEqual(['sentiment'])
    expect([...bravo]).toEqual(['churn_risk'])
  })

  it('separates in the other order too', async () => {
    hoisted.rows.set('tenant-alpha', { live: [graphReferencing('sentiment')] })
    hoisted.rows.set('tenant-bravo', { live: [graphReferencing('churn_risk')] })

    const bravo = await withTenant('tenant-bravo', () => getLiveWorkflowReferencedAttributeKeys())
    const alpha = await withTenant('tenant-alpha', () => getLiveWorkflowReferencedAttributeKeys())

    expect([...bravo]).toEqual(['churn_risk'])
    expect([...alpha]).toEqual(['sentiment'])
  })

  it('does not hand an empty workspace a neighbour’s keys', async () => {
    hoisted.rows.set('tenant-alpha', { live: [graphReferencing('sentiment')] })
    hoisted.rows.set('tenant-bravo', { live: [] })

    await withTenant('tenant-alpha', () => getLiveWorkflowReferencedAttributeKeys())
    const bravo = await withTenant('tenant-bravo', () => getLiveWorkflowReferencedAttributeKeys())

    expect([...bravo]).toEqual([])
  })

  it('still caches within a tenant', async () => {
    hoisted.rows.set('tenant-alpha', { live: [graphReferencing('sentiment')] })
    await withTenant('tenant-alpha', async () => {
      await getLiveWorkflowReferencedAttributeKeys()
      await getLiveWorkflowReferencedAttributeKeys()
    })

    expect(hoisted.reads.filter((t) => t === 'tenant-alpha')).toHaveLength(1)
  })
})
