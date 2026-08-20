/**
 * The tier-limits cache is the billing ceiling, and a cross-workspace hit is
 * silent: nothing errors, the wrong allowance is simply believed. The
 * two-workspace isolation probe suite cannot see it (both workspaces read a number
 * that is plausible for either), so it needs its own assertion.
 *
 * The database is stubbed to return a DIFFERENT stored row per workspace, and the
 * stub counts reads — so the suite also proves the cache is still a cache
 * rather than accidentally disabled, which would make every isolation
 * assertion pass for the wrong reason.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  /** workspaceKey (or '' when unscoped) -> stored tier_limits JSON */
  rows: new Map<string, string | null>(),
  selectCalls: [] as string[],
  currentWorkspaceKey: (): string => '',
}))

vi.mock('@/lib/server/db', () => ({
  settings: { tierLimits: 'tier_limits' },
  db: {
    select: () => ({
      from: () => ({
        limit: async () => {
          const id = hoisted.currentWorkspaceKey()
          hoisted.selectCalls.push(id)
          return [{ tierLimits: hoisted.rows.get(id) ?? null }]
        },
      }),
    }),
  },
}))

const { getTierLimits, invalidateTierLimitsCache } = await import('../tier-limits.service')
const { withWorkspace } = await import('@/lib/server/__tests__/workspace-scope')
const { getCurrentWorkspace } = await import('@/lib/server/workspaces/workspace-context')

hoisted.currentWorkspaceKey = () => getCurrentWorkspace()?.workspaceKey ?? ''

beforeEach(() => {
  hoisted.rows.clear()
  hoisted.selectCalls.length = 0
  // Each workspace's cache entry is separate, so each must be cleared separately.
  for (const id of ['workspace-alpha', 'workspace-bravo']) {
    withWorkspace(id, () => invalidateTierLimitsCache())
  }
  invalidateTierLimitsCache()
})

describe('tier-limits cache', () => {
  it('does not serve one workspace the limits it read for another', async () => {
    hoisted.rows.set('workspace-alpha', JSON.stringify({ maxBoards: 3 }))
    hoisted.rows.set('workspace-bravo', JSON.stringify({ maxBoards: 99 }))

    const alpha = await withWorkspace('workspace-alpha', () => getTierLimits())
    const bravo = await withWorkspace('workspace-bravo', () => getTierLimits())

    expect(alpha.maxBoards).toBe(3)
    expect(bravo.maxBoards).toBe(99)
  })

  it('separates in the other order too', async () => {
    hoisted.rows.set('workspace-alpha', JSON.stringify({ maxBoards: 3 }))
    hoisted.rows.set('workspace-bravo', JSON.stringify({ maxBoards: 99 }))

    const bravo = await withWorkspace('workspace-bravo', () => getTierLimits())
    const alpha = await withWorkspace('workspace-alpha', () => getTierLimits())

    expect(bravo.maxBoards).toBe(99)
    expect(alpha.maxBoards).toBe(3)
  })

  it('does not leak a paid feature flag into a restricted workspace', async () => {
    hoisted.rows.set('workspace-alpha', JSON.stringify({ features: { customOidcProvider: true } }))
    hoisted.rows.set('workspace-bravo', JSON.stringify({ features: { customOidcProvider: false } }))

    const alpha = await withWorkspace('workspace-alpha', () => getTierLimits())
    const bravo = await withWorkspace('workspace-bravo', () => getTierLimits())

    expect(alpha.features.customOidcProvider).toBe(true)
    expect(bravo.features.customOidcProvider).toBe(false)
  })

  it('still caches within a workspace — one read, not one per call', async () => {
    hoisted.rows.set('workspace-alpha', JSON.stringify({ maxBoards: 3 }))

    await withWorkspace('workspace-alpha', async () => {
      await getTierLimits()
      await getTierLimits()
      await getTierLimits()
    })

    expect(hoisted.selectCalls.filter((id) => id === 'workspace-alpha')).toHaveLength(1)
  })

  it('invalidation clears only the workspace that asked', async () => {
    hoisted.rows.set('workspace-alpha', JSON.stringify({ maxBoards: 3 }))
    hoisted.rows.set('workspace-bravo', JSON.stringify({ maxBoards: 99 }))
    await withWorkspace('workspace-alpha', () => getTierLimits())
    await withWorkspace('workspace-bravo', () => getTierLimits())
    hoisted.selectCalls.length = 0

    hoisted.rows.set('workspace-alpha', JSON.stringify({ maxBoards: 7 }))
    withWorkspace('workspace-alpha', () => invalidateTierLimitsCache())

    expect(await withWorkspace('workspace-alpha', () => getTierLimits())).toMatchObject({
      maxBoards: 7,
    })
    expect(await withWorkspace('workspace-bravo', () => getTierLimits())).toMatchObject({
      maxBoards: 99,
    })
    expect(hoisted.selectCalls).toEqual(['workspace-alpha'])
  })
})
