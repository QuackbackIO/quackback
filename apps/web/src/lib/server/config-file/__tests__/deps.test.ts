/**
 * Tests for the production `ReconcileDeps` wiring — specifically that
 * `createSettings` writes a non-zero `authConfigVersion` so pods that
 * cached Better-Auth before the first settings row existed invalidate
 * on the next request.
 *
 * Without this, both the cached instance and the freshly-created row
 * land on `authConfigVersion=0`, the `getAuth()` mismatch check passes,
 * and pod B keeps serving auth without the SSO provider any other pod
 * just registered.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  insertValuesCalls: [] as Array<Record<string, unknown>>,
  mockOnConflictDoNothing: vi.fn(async () => {}),
}))

const mockValues = vi.fn((vals: Record<string, unknown>) => {
  hoisted.insertValuesCalls.push(vals)
  return { onConflictDoNothing: hoisted.mockOnConflictDoNothing }
})

vi.mock('@/lib/server/db', () => ({
  db: {
    insert: vi.fn(() => ({ values: mockValues })),
    query: { settings: { findFirst: vi.fn() } },
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({})),
  },
  settings: { id: 'settings.id' },
  eq: vi.fn(),
}))

vi.mock('@/lib/server/domains/settings/settings.helpers', () => ({
  invalidateSettingsCache: vi.fn(async () => {}),
}))

vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  invalidateTierLimitsCache: vi.fn(),
}))

vi.mock('@/lib/server/auth/index', () => ({
  resetAuth: vi.fn(),
}))

vi.mock('@/lib/server/auth/config-version', () => ({
  bumpAuthConfigVersionInTx: vi.fn(async () => {}),
}))

vi.mock('@quackback/ids', () => ({
  generateId: vi.fn(() => 'ws_test'),
}))

vi.mock('../report-status', () => ({
  makeReportStatus: () => vi.fn(),
}))

const { makeReconcileDeps } = await import('../deps')

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.insertValuesCalls.length = 0
})

describe('createSettings', () => {
  it('writes a non-zero authConfigVersion so pre-create caches invalidate', async () => {
    const deps = makeReconcileDeps()
    await deps.createSettings({
      name: 'Acme',
      slug: 'acme',
      setupState: '{}',
      managedFieldPaths: [],
    })

    expect(hoisted.insertValuesCalls).toHaveLength(1)
    const values = hoisted.insertValuesCalls[0]
    // Default column value is 0; recording the first auth instance also
    // records version 0. A non-zero version on first insert forces any
    // pre-create cached auth instance to invalidate on next request.
    expect(values.authConfigVersion).toBeTypeOf('number')
    expect(values.authConfigVersion).not.toBe(0)
  })
})
