/**
 * Enabling MCP must hit the same entitlement gate as the MCP request path.
 *
 *   updateDeveloperConfig({ mcpEnabled: true }) -> requireEntitlement('mcpServer')
 *
 * Disabling stays open. Cloud-off is a no-op so self-host can still flip the
 * switch.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EntitlementRequiredError } from '@/lib/server/errors/entitlement-error'

const hoisted = vi.hoisted(() => ({
  requireEntitlement: vi.fn(),
  mockRequireSettings: vi.fn(),
  mockDbUpdate: vi.fn(() => ({
    set: () => ({ where: vi.fn() }),
  })),
}))

vi.mock('@/lib/server/domains/settings/cloud/entitlements', () => ({
  requireEntitlement: (...args: unknown[]) => hoisted.requireEntitlement(...args),
}))

vi.mock('@/lib/server/domains/settings/tier-limits.service', () => ({
  getTierLimits: vi.fn(),
}))

vi.mock('@/lib/server/db', async (importOriginal) => {
  const tx = { update: hoisted.mockDbUpdate }
  return {
    ...(await importOriginal<typeof import('@/lib/server/db')>()),
    db: {
      update: hoisted.mockDbUpdate,
      transaction: async (fn: (tx: { update: typeof hoisted.mockDbUpdate }) => unknown) => fn(tx),
    },
    eq: vi.fn(),
  }
})

vi.mock('@/lib/server/auth/config-version', () => ({
  bumpAuthConfigVersionInTx: vi.fn(),
}))

vi.mock('@/lib/server/auth', () => ({
  resetAuth: vi.fn(),
}))

vi.mock('@/lib/server/cache', () => ({
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  cacheDel: vi.fn(),
  CACHE_KEYS: { SETTINGS: 's' },
}))

vi.mock('../settings.helpers', () => ({
  requireSettings: hoisted.mockRequireSettings,
  parseJsonConfig: <T>(_raw: string | null, def: T): T => def,
  invalidateSettingsCache: vi.fn(),
  wrapDbError: (_msg: string, err: unknown) => {
    throw err
  },
  deepMerge: <T>(a: T, b: Partial<T>) => ({ ...a, ...b }),
}))

vi.mock('@/lib/server/config-file/managed-guard', () => ({
  assertNotManaged: vi.fn(async () => {}),
}))

import { updateDeveloperConfig } from '../settings.service'
import { getTierLimits } from '@/lib/server/domains/settings/tier-limits.service'
import { OSS_TIER_LIMITS } from '@/lib/server/domains/settings/tier-limits.types'

describe('updateDeveloperConfig — mcpServer entitlement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.mockRequireSettings.mockResolvedValue({ id: 'org_x', developerConfig: null })
    vi.mocked(getTierLimits).mockResolvedValue(OSS_TIER_LIMITS)
    hoisted.requireEntitlement.mockResolvedValue(undefined)
  })

  it('refuses enable on a plan without the entitlement and names the plan', async () => {
    hoisted.requireEntitlement.mockRejectedValue(
      new EntitlementRequiredError({
        entitlement: 'mcpServer',
        friendly: 'The MCP server',
        friendlyIsPlural: false,
        requiredPlanArticle: 'a',
        currentPlan: 'free',
        currentPlanName: 'Free',
        requiredPlan: 'growth',
        requiredPlanName: 'Growth',
      })
    )

    const refusal = await updateDeveloperConfig({ mcpEnabled: true }).catch(
      (error: unknown) => error
    )

    expect(refusal).toBeInstanceOf(EntitlementRequiredError)
    const error = refusal as EntitlementRequiredError
    expect(error.entitlement).toBe('mcpServer')
    expect(error.requiredPlanName).toBe('Growth')
    expect(error.statusCode).toBe(402)
    expect(hoisted.requireEntitlement).toHaveBeenCalledWith('mcpServer')
    expect(hoisted.mockDbUpdate).not.toHaveBeenCalled()
  })

  it('enables when the entitlement is granted', async () => {
    await expect(updateDeveloperConfig({ mcpEnabled: true })).resolves.toBeDefined()
    expect(hoisted.requireEntitlement).toHaveBeenCalledWith('mcpServer')
    expect(hoisted.mockDbUpdate).toHaveBeenCalled()
  })

  it('does not ask the entitlement gate when disabling', async () => {
    await expect(updateDeveloperConfig({ mcpEnabled: false })).resolves.toBeDefined()
    expect(hoisted.requireEntitlement).not.toHaveBeenCalled()
  })
})
