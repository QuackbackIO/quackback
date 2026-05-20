/**
 * Integration smoke tests: each managed-eligible mutator should call
 * assertNotManaged() at its head and propagate the resulting
 * ForbiddenError. We don't re-test the gate's matching logic here —
 * managed-guard.test covers that — we just verify the wiring.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ForbiddenError } from '@/lib/shared/errors'

const hoisted = vi.hoisted(() => ({
  mockGetTenantSettings: vi.fn(),
  mockRequireSettings: vi.fn(),
  mockUpdateChain: vi.fn(),
  mockDbUpdate: vi.fn(),
  mockDbInsert: vi.fn(),
  mockDbSelect: vi.fn(),
}))

vi.mock('@/lib/server/db', () => {
  return {
    db: {
      update: hoisted.mockDbUpdate,
      insert: hoisted.mockDbInsert,
      select: hoisted.mockDbSelect,
    },
    settings: { id: 'id', slug: 'slug' },
    eq: vi.fn(),
  }
})

vi.mock('@/lib/server/redis', () => ({
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  cacheDel: vi.fn(),
  CACHE_KEYS: { SETTINGS: 's' },
}))

vi.mock('../settings.helpers', () => ({
  requireSettings: hoisted.mockRequireSettings,
  parseJsonConfig: <T>(_raw: string | null, def: T): T => def,
  parseJsonOrNull: () => null,
  invalidateSettingsCache: vi.fn(),
  wrapDbError: (_msg: string, err: unknown) => {
    throw err
  },
  deepMerge: <T>(a: T, b: Partial<T>) => ({ ...a, ...b }),
}))

// The gate dynamic-imports settings.service from inside its handler, so
// we mock the top-level service and supply our own getTenantSettings.
vi.mock('../settings.service', () => ({
  getTenantSettings: hoisted.mockGetTenantSettings,
}))

import { updateWorkspaceName } from '../settings.media'

describe('updateWorkspaceName — managed-paths gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.mockRequireSettings.mockResolvedValue({ id: 'org_x' })
    hoisted.mockDbUpdate.mockReturnValue({
      set: () => ({
        where: () => ({
          returning: async () => [{ name: 'Acme' }],
        }),
      }),
    })
  })

  it('throws ForbiddenError when workspace.name is managed', async () => {
    hoisted.mockGetTenantSettings.mockResolvedValue({
      managedFieldPaths: ['workspace.name'],
    })
    await expect(updateWorkspaceName('Acme')).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('writes through when workspace.name is not managed', async () => {
    hoisted.mockGetTenantSettings.mockResolvedValue({
      managedFieldPaths: [],
    })
    await expect(updateWorkspaceName('Acme')).resolves.toBe('Acme')
  })
})
