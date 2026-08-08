/**
 * The tier-limits cache is the billing ceiling, and a cross-tenant hit is
 * silent: nothing errors, the wrong allowance is simply believed. The
 * two-tenant isolation probe suite cannot see it (both tenants read a number
 * that is plausible for either), so it needs its own assertion.
 *
 * The database is stubbed to return a DIFFERENT stored row per tenant, and the
 * stub counts reads — so the suite also proves the cache is still a cache
 * rather than accidentally disabled, which would make every isolation
 * assertion pass for the wrong reason.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  /** tenantId (or '' when unscoped) -> stored tier_limits JSON */
  rows: new Map<string, string | null>(),
  selectCalls: [] as string[],
  currentTenantId: (): string => '',
}))

vi.mock('@/lib/server/db', () => ({
  settings: { tierLimits: 'tier_limits' },
  db: {
    select: () => ({
      from: () => ({
        limit: async () => {
          const id = hoisted.currentTenantId()
          hoisted.selectCalls.push(id)
          return [{ tierLimits: hoisted.rows.get(id) ?? null }]
        },
      }),
    }),
  },
}))

const { getTierLimits, invalidateTierLimitsCache } = await import('../tier-limits.service')
const { withTenant } = await import('@/lib/server/__tests__/tenant-scope')
const { getCurrentTenant } = await import('@/lib/server/tenancy/tenant-context')

hoisted.currentTenantId = () => getCurrentTenant()?.tenantId ?? ''

beforeEach(() => {
  hoisted.rows.clear()
  hoisted.selectCalls.length = 0
  // Each tenant's cache entry is separate, so each must be cleared separately.
  for (const id of ['tenant-alpha', 'tenant-bravo']) {
    withTenant(id, () => invalidateTierLimitsCache())
  }
  invalidateTierLimitsCache()
})

describe('tier-limits cache', () => {
  it('does not serve one tenant the limits it read for another', async () => {
    hoisted.rows.set('tenant-alpha', JSON.stringify({ maxBoards: 3 }))
    hoisted.rows.set('tenant-bravo', JSON.stringify({ maxBoards: 99 }))

    const alpha = await withTenant('tenant-alpha', () => getTierLimits())
    const bravo = await withTenant('tenant-bravo', () => getTierLimits())

    expect(alpha.maxBoards).toBe(3)
    expect(bravo.maxBoards).toBe(99)
  })

  it('separates in the other order too', async () => {
    hoisted.rows.set('tenant-alpha', JSON.stringify({ maxBoards: 3 }))
    hoisted.rows.set('tenant-bravo', JSON.stringify({ maxBoards: 99 }))

    const bravo = await withTenant('tenant-bravo', () => getTierLimits())
    const alpha = await withTenant('tenant-alpha', () => getTierLimits())

    expect(bravo.maxBoards).toBe(99)
    expect(alpha.maxBoards).toBe(3)
  })

  it('does not leak a paid feature flag into a restricted tenant', async () => {
    hoisted.rows.set('tenant-alpha', JSON.stringify({ features: { customOidcProvider: true } }))
    hoisted.rows.set('tenant-bravo', JSON.stringify({ features: { customOidcProvider: false } }))

    const alpha = await withTenant('tenant-alpha', () => getTierLimits())
    const bravo = await withTenant('tenant-bravo', () => getTierLimits())

    expect(alpha.features.customOidcProvider).toBe(true)
    expect(bravo.features.customOidcProvider).toBe(false)
  })

  it('still caches within a tenant — one read, not one per call', async () => {
    hoisted.rows.set('tenant-alpha', JSON.stringify({ maxBoards: 3 }))

    await withTenant('tenant-alpha', async () => {
      await getTierLimits()
      await getTierLimits()
      await getTierLimits()
    })

    expect(hoisted.selectCalls.filter((id) => id === 'tenant-alpha')).toHaveLength(1)
  })

  it('invalidation clears only the tenant that asked', async () => {
    hoisted.rows.set('tenant-alpha', JSON.stringify({ maxBoards: 3 }))
    hoisted.rows.set('tenant-bravo', JSON.stringify({ maxBoards: 99 }))
    await withTenant('tenant-alpha', () => getTierLimits())
    await withTenant('tenant-bravo', () => getTierLimits())
    hoisted.selectCalls.length = 0

    hoisted.rows.set('tenant-alpha', JSON.stringify({ maxBoards: 7 }))
    withTenant('tenant-alpha', () => invalidateTierLimitsCache())

    expect(await withTenant('tenant-alpha', () => getTierLimits())).toMatchObject({ maxBoards: 7 })
    expect(await withTenant('tenant-bravo', () => getTierLimits())).toMatchObject({ maxBoards: 99 })
    expect(hoisted.selectCalls).toEqual(['tenant-alpha'])
  })
})
