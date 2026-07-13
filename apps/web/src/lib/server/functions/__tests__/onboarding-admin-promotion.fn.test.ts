import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const chain: Record<string, unknown> = {}
    chain.validator = () => chain
    chain.handler = (handler: (args: { data?: unknown }) => Promise<unknown>) =>
      Object.assign((args?: { data?: unknown }) => handler(args ?? {}), chain)
    return chain
  },
}))

const hoisted = vi.hoisted(() => ({
  getSession: vi.fn(),
  getSettings: vi.fn(),
  principalFindFirst: vi.fn(),
  postStatusesFindFirst: vi.fn(),
  ensurePrincipalForUser: vi.fn(),
  setPrincipalRole: vi.fn(),
  settingsInsert: vi.fn(),
  invalidateSettingsCache: vi.fn(),
}))

vi.mock('@/lib/server/auth/session', () => ({ getSession: hoisted.getSession }))
vi.mock('@/lib/server/functions/workspace', () => ({ getSettings: hoisted.getSettings }))
vi.mock('@/lib/server/domains/principals/principal.service', () => ({
  syncPrincipalProfile: vi.fn(),
}))
vi.mock('@/lib/server/domains/principals/principal.factory', () => ({
  ensurePrincipalForUser: hoisted.ensurePrincipalForUser,
  setPrincipalRole: hoisted.setPrincipalRole,
}))
vi.mock('@/lib/server/domains/settings/settings.helpers', () => ({
  invalidateSettingsCache: hoisted.invalidateSettingsCache,
}))
vi.mock('@/lib/server/domains/settings', () => ({
  DEFAULT_AUTH_CONFIG: { openSignup: false },
  DEFAULT_PORTAL_CONFIG: {},
}))
vi.mock('@/lib/server/config-file/managed-paths', () => ({
  isPathManaged: vi.fn((path: string, paths: string[] | null | undefined) =>
    (paths ?? []).includes(path)
  ),
}))
vi.mock('@quackback/ids', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@quackback/ids')>()),
  generateId: vi.fn((type: string) => `${type}_test`),
}))
vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ debug: vi.fn(), info: vi.fn(), error: vi.fn() }) },
}))

vi.mock('@/lib/server/setup-state', () => ({
  mutateSetupStateAtomic: vi.fn(
    async (
      mutate: (
        current: Record<string, unknown>,
        row: Record<string, unknown>,
        tx: Record<string, unknown>
      ) => Promise<{ state: Record<string, unknown>; value: unknown }>
    ) => {
      const row = await hoisted.getSettings()
      const tx = {
        update: vi.fn(() => ({
          set: vi.fn((values: Record<string, unknown>) => ({
            where: vi.fn(() => ({
              returning: vi.fn(async () => [{ ...row, ...values }]),
            })),
          })),
        })),
      }
      return mutate(JSON.parse(row.setupState), row, tx)
    }
  ),
}))

vi.mock('@/lib/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/db')>()
  const tx = {
    execute: vi.fn(),
    query: { principal: { findFirst: hoisted.principalFindFirst } },
  }
  return {
    ...actual,
    db: {
      transaction: vi.fn(async (callback: (executor: typeof tx) => Promise<unknown>) =>
        callback(tx)
      ),
      query: {
        principal: { findFirst: hoisted.principalFindFirst },
        postStatuses: { findFirst: hoisted.postStatusesFindFirst },
      },
      insert: vi.fn((table: unknown) => ({
        values: vi.fn((values: Record<string, unknown>) => {
          if (table === actual.settings) {
            hoisted.settingsInsert(values)
            return {
              returning: vi.fn(async () => [
                {
                  id: 'workspace_test',
                  name: values.name,
                  slug: values.slug,
                },
              ]),
            }
          }
          return Promise.resolve()
        }),
      })),
    },
  }
})

const { saveWorkspaceAndGoalFn } = await import('../onboarding')

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.getSession.mockResolvedValue({ user: { id: 'user_caller' } })
  hoisted.postStatusesFindFirst.mockResolvedValue({ id: 'status_existing' })
})

describe('saveWorkspaceAndGoalFn bootstrap authorization', () => {
  it('rejects a non-admin once workspace setup is owned', async () => {
    hoisted.getSettings.mockResolvedValue({
      id: 'workspace_1',
      name: 'Acme',
      slug: 'acme',
      managedFieldPaths: [],
      setupState: JSON.stringify({
        version: 2,
        steps: { core: true, workspace: true, startingPoint: null },
        useCase: 'product_feedback',
      }),
    })
    hoisted.principalFindFirst.mockResolvedValue({ id: 'principal_1', role: 'member' })

    await expect(
      saveWorkspaceAndGoalFn({
        data: { workspaceName: 'Acme', useCase: 'product_feedback' },
      })
    ).rejects.toThrow(/only admin/i)
    expect(hoisted.settingsInsert).not.toHaveBeenCalled()
  })

  it('promotes the first user and creates one combined V2 workspace record', async () => {
    hoisted.getSettings.mockResolvedValue(undefined)
    hoisted.principalFindFirst.mockResolvedValue(undefined)
    hoisted.ensurePrincipalForUser.mockResolvedValue({
      created: true,
      principal: { id: 'principal_1', role: 'admin' },
    })

    const result = await saveWorkspaceAndGoalFn({
      data: { workspaceName: 'Acme Inc', useCase: 'customer_support' },
    })

    expect(hoisted.ensurePrincipalForUser).toHaveBeenCalledWith(
      { userId: 'user_caller', role: 'admin' },
      expect.any(Object)
    )
    expect(hoisted.settingsInsert).toHaveBeenCalledOnce()
    const inserted = hoisted.settingsInsert.mock.calls[0]![0]
    expect(JSON.parse(inserted.setupState as string)).toEqual(
      expect.objectContaining({
        version: 2,
        steps: { core: true, workspace: true, startingPoint: null },
        useCase: 'customer_support',
      })
    )
    expect(result).toEqual(
      expect.objectContaining({
        id: 'workspace_test',
        name: 'Acme Inc',
        slug: 'acme-inc',
        useCase: 'customer_support',
      })
    )
  })

  it('keeps a managed slug fixed while allowing the workspace name to change', async () => {
    hoisted.getSettings.mockResolvedValue({
      id: 'workspace_1',
      name: 'Acme',
      slug: 'fixed-portal',
      managedFieldPaths: ['workspace.slug'],
      setupState: JSON.stringify({
        version: 2,
        steps: { core: true, workspace: true, startingPoint: null },
        useCase: 'product_feedback',
      }),
    })
    hoisted.principalFindFirst.mockResolvedValue({ id: 'principal_1', role: 'admin' })

    const result = await saveWorkspaceAndGoalFn({
      data: { workspaceName: 'Acme Labs', useCase: 'product_feedback' },
    })

    expect(result.name).toBe('Acme Labs')
    expect(result.slug).toBe('fixed-portal')
    expect(result.managed).toEqual({ name: false, slug: true, useCase: false })
  })

  it.each([
    {
      managedFieldPaths: ['workspace.name'],
      data: { workspaceName: 'Different name', useCase: 'product_feedback' as const },
      message: /workspace name is managed/i,
    },
    {
      managedFieldPaths: ['workspace.useCase'],
      data: { workspaceName: 'Acme', useCase: 'internal' as const },
      message: /workspace goal is managed/i,
    },
  ])('enforces each managed field independently: $managedFieldPaths', async (example) => {
    hoisted.getSettings.mockResolvedValue({
      id: 'workspace_1',
      name: 'Acme',
      slug: 'acme',
      managedFieldPaths: example.managedFieldPaths,
      setupState: JSON.stringify({
        version: 2,
        steps: { core: true, workspace: true, startingPoint: null },
        useCase: 'product_feedback',
      }),
    })
    hoisted.principalFindFirst.mockResolvedValue({ id: 'principal_1', role: 'admin' })

    await expect(saveWorkspaceAndGoalFn({ data: example.data })).rejects.toThrow(example.message)
  })
})
