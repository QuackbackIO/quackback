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
  mockOnConflictDoNothing: vi.fn(),
  ensureNewWorkspaceLabs: vi.fn(async (_settingsId: string, _executor?: unknown) => {}),
}))

const mockValues = vi.fn((vals: Record<string, unknown>) => {
  hoisted.insertValuesCalls.push(vals)
  return {
    onConflictDoNothing: () => {
      hoisted.mockOnConflictDoNothing()
      return { returning: async () => [{ id: vals.id }] }
    },
  }
})

const mockInsert = vi.fn(() => ({ values: mockValues }))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  // Spread the real db module so tables/operators stay current; override only what this suite drives.
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    insert: mockInsert,
    query: { settings: { findFirst: vi.fn() } },
    transaction: vi.fn(async (fn: (tx: { insert: typeof mockInsert }) => Promise<unknown>) =>
      fn({ insert: mockInsert })
    ),
  },
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

vi.mock('@/lib/server/domains/settings/settings.labs', () => ({
  ensureNewWorkspaceLabs: (settingsId: string, executor?: unknown) =>
    hoisted.ensureNewWorkspaceLabs(settingsId, executor),
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
    expect(JSON.parse(String(values.featureFlags))).toMatchObject({
      feedback: true,
      changelog: true,
      helpCenter: false,
      supportInbox: false,
      supportTickets: false,
      statusPage: false,
    })
    expect(hoisted.ensureNewWorkspaceLabs).toHaveBeenCalledWith(
      'ws_test',
      expect.objectContaining({ insert: expect.any(Function) })
    )
  })

  it('enables Help Center as a product when the stamped goal is help_center', async () => {
    const deps = makeReconcileDeps()
    await deps.createSettings({
      name: 'Docs',
      slug: 'docs',
      setupState: JSON.stringify({ useCase: 'help_center' }),
      managedFieldPaths: [],
    })
    const flags = JSON.parse(String(hoisted.insertValuesCalls[0].featureFlags))
    expect(flags.helpCenter).toBe(true)
    expect(flags.supportInbox).toBe(false)
  })
})
