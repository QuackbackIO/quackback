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
  txExecute: vi.fn(),
  principalFindFirst: vi.fn(),
  /** Reads made INSIDE the bootstrap transaction, kept distinct from the
   *  entry gate's reads so the lock-ordering assertion cannot be satisfied
   *  by a query that ran before the transaction opened. */
  txPrincipalFindFirst: vi.fn(),
  postStatusesFindFirst: vi.fn(),
  ensurePrincipalForUser: vi.fn(),
  setPrincipalRole: vi.fn(),
  settingsInsert: vi.fn(),
  invalidateSettingsCache: vi.fn(),
  flagWrites: [] as Record<string, unknown>[],
  /** What `settings.cloud_workspace_key` holds — null on an install, a key on a
   *  workspace a control plane created. Read by the tx `execute` double below. */
  stamp: { value: null as string | null },
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
  logger: { child: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}))

// Only the atomic mutator is replaced. `applyDeferredLaunchStartingPoint` is a
// pure state transform the promotion path calls, so the real one runs and the
// assertions below see the state it actually produces.
vi.mock('@/lib/server/setup-state', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/setup-state')>()),
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
          set: vi.fn((values: Record<string, unknown>) => {
            hoisted.flagWrites.push(values)
            return {
              where: vi.fn(() => ({
                returning: vi.fn(async () => [{ ...row, ...values }]),
              })),
            }
          }),
        })),
      }
      return mutate(JSON.parse(row.setupState), row, tx)
    }
  ),
}))

vi.mock('@/lib/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/db')>()
  const tx = {
    execute: hoisted.txExecute,
    query: { principal: { findFirst: hoisted.txPrincipalFindFirst } },
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

const { saveWorkspaceAndGoalFn, saveCloudOnboardingGoalFn } = await import('../onboarding')
const { DEFAULT_FEATURE_FLAGS, resolveFeatureFlags } =
  await import('@/lib/server/domains/settings/settings.types')
const { bootstrapAdminLock } = await import('@/lib/server/domains/principals/bootstrap-admin')

beforeEach(() => {
  vi.clearAllMocks()
  hoisted.flagWrites = []
  hoisted.getSession.mockResolvedValue({ user: { id: 'user_caller' } })
  hoisted.postStatusesFindFirst.mockResolvedValue({ id: 'status_existing' })
  hoisted.stamp.value = null
  // The transaction's `execute` answers by statement, as the real one does: the
  // advisory lock returns nothing, the provenance read returns the settings row
  // the fixture's workspace shape implies. A double that answered both alike
  // could not tell a lock from a read, and this file's central assertion is
  // about the ordering between exactly those two.
  hoisted.txExecute.mockImplementation(async (statement: { queryChunks?: unknown[] }) => {
    const text = JSON.stringify(statement?.queryChunks ?? '')
    if (!text.includes('cloud_workspace_key')) return undefined
    return [{ stamp_column: hoisted.stamp.value, metadata: null }]
  })
})

/** A workspace whose wizard steps are already stamped. */
const STAMPED_SETTINGS = {
  id: 'workspace_1',
  name: 'Acme',
  slug: 'acme',
  managedFieldPaths: [] as string[],
  setupState: JSON.stringify({
    version: 2,
    steps: { core: true, workspace: true, startingPoint: null },
    useCase: 'product_feedback',
  }),
}

describe('saveWorkspaceAndGoalFn bootstrap authorization', () => {
  it('rejects a non-admin once workspace setup is owned', async () => {
    hoisted.getSettings.mockResolvedValue({ ...STAMPED_SETTINGS })
    hoisted.principalFindFirst.mockResolvedValue({ id: 'principal_1', role: 'member' })

    await expect(
      saveWorkspaceAndGoalFn({
        data: { workspaceName: 'Acme', useCase: 'product_feedback' },
      })
    ).rejects.toThrow(/only admin/i)
    expect(hoisted.settingsInsert).not.toHaveBeenCalled()
    // Refused at the gate: the promoter is never even opened.
    expect(hoisted.ensurePrincipalForUser).not.toHaveBeenCalled()
    expect(hoisted.txExecute).not.toHaveBeenCalled()
  })

  // The declarative config file stamps the workspace step before anyone has
  // ever signed in, so a stamp is not an owner. Gating on the stamp instead of
  // on ownership left a pre-stamped workspace with nobody able to claim it: the
  // first user was refused here, and the only thing that had been promoting
  // them was a loader that must not write.
  it('lets the first user claim a workspace whose setup arrived pre-stamped', async () => {
    hoisted.getSettings.mockResolvedValue({ ...STAMPED_SETTINGS })
    hoisted.principalFindFirst.mockResolvedValue(undefined)
    hoisted.ensurePrincipalForUser.mockResolvedValue({
      created: true,
      principal: { id: 'principal_1', role: 'admin' },
    })

    await saveWorkspaceAndGoalFn({
      data: { workspaceName: 'Acme', useCase: 'product_feedback' },
    })

    expect(hoisted.ensurePrincipalForUser).toHaveBeenCalledWith(
      { userId: 'user_caller', role: 'admin' },
      expect.any(Object)
    )
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
        steps: expect.objectContaining({
          core: true,
          workspace: true,
          // The wizard defers the starter artifact to the use-case launch
          // list, so it records that choice rather than leaving the step
          // unanswered: resolved, but with nothing created.
          startingPoint: expect.objectContaining({
            outcome: 'customer_support',
            resourceType: 'none',
            source: 'wizard',
            resolution: 'deferred',
          }),
        }),
        useCase: 'customer_support',
      })
    )
    expect(result).toEqual(
      expect.objectContaining({
        id: 'workspace_test',
        name: 'Acme Inc',
        slug: 'acme-inc',
        useCase: 'customer_support',
        enabledModules: ['Support'],
      })
    )
  })

  // What keeps two simultaneous first users from both observing an empty
  // admin set: the advisory lock is taken inside the same transaction, and
  // before anything is read. Reading first and locking after would leave the
  // window open, so the ordering is the invariant, not merely the presence.
  //
  // The KEY matters as much as the ordering: the SSO callback can also hand out
  // the first admin, and two promoters holding two different keys exclude each
  // other exactly as much as no lock at all. Both take the key this asserts.
  it('takes the shared bootstrap advisory lock before reading the admin set', async () => {
    hoisted.getSettings.mockResolvedValue(undefined)
    hoisted.principalFindFirst.mockResolvedValue(undefined)
    hoisted.ensurePrincipalForUser.mockResolvedValue({
      created: true,
      principal: { id: 'principal_1', role: 'admin' },
    })

    await saveWorkspaceAndGoalFn({
      data: { workspaceName: 'Acme Inc', useCase: 'customer_support' },
    })

    const locked = hoisted.txExecute.mock.calls[0]![0] as { queryChunks?: unknown[] }
    expect(JSON.stringify(locked.queryChunks)).toContain('pg_advisory_xact_lock')
    expect(JSON.stringify(locked.queryChunks)).toBe(
      JSON.stringify(bootstrapAdminLock().queryChunks)
    )
    // Every read the transaction makes happens after the lock. Compared against
    // the transaction's own reads, so an entry-gate read that ran before the
    // transaction opened cannot make this pass.
    expect(hoisted.txPrincipalFindFirst).toHaveBeenCalled()
    expect(hoisted.txExecute.mock.invocationCallOrder[0]).toBeLessThan(
      hoisted.txPrincipalFindFirst.mock.invocationCallOrder[0]!
    )
    // The provenance read is a read like any other, and it decides whether this
    // caller may be promoted — so it composes with the lock rather than racing
    // it. Asserted on the transaction's OWN executor, which is what makes it a
    // statement about the lock window rather than about a query somewhere.
    const provenance = hoisted.txExecute.mock.calls.findIndex(([statement]) =>
      JSON.stringify((statement as { queryChunks?: unknown[] })?.queryChunks).includes(
        'cloud_workspace_key'
      )
    )
    expect(provenance).toBeGreaterThan(0)
  })

  // The workspace this guard exists for. Every fact is identical to the
  // promotion case above except the one the control plane wrote.
  it('refuses to promote an arrival on a workspace a control plane created', async () => {
    hoisted.stamp.value = 'ws_acme'
    hoisted.getSettings.mockResolvedValue(undefined)
    hoisted.principalFindFirst.mockResolvedValue(undefined)

    await expect(
      saveWorkspaceAndGoalFn({ data: { workspaceName: 'Acme Inc', useCase: 'customer_support' } })
    ).rejects.toThrow(/not open to be set up/i)
    expect(hoisted.ensurePrincipalForUser).not.toHaveBeenCalled()
    expect(hoisted.setPrincipalRole).not.toHaveBeenCalled()
    expect(hoisted.settingsInsert).not.toHaveBeenCalled()
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
    expect(result.enabledModules).toEqual([])
  })

  it('enables Help Center when an existing workspace picks that goal', async () => {
    hoisted.getSettings.mockResolvedValue({
      ...STAMPED_SETTINGS,
      featureFlags: JSON.stringify(DEFAULT_FEATURE_FLAGS),
    })
    hoisted.principalFindFirst.mockResolvedValue({ id: 'principal_1', role: 'admin' })

    const result = await saveWorkspaceAndGoalFn({
      data: { workspaceName: 'Acme', useCase: 'help_center' },
    })

    expect(result.enabledModules).toEqual(['Help Center'])
    const written = hoisted.flagWrites.find((values) => typeof values.featureFlags === 'string')
    expect(resolveFeatureFlags(written!.featureFlags as string).helpCenter).toBe(true)
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

const CLOUD_IDENTITY = {
  version: 4,
  displayName: 'Acme',
  canonicalOrigin: 'https://acme.example.com',
  platformHostname: 'acme.example.com',
  customDomains: [],
  updatedAt: '2026-08-14T12:00:00.000Z',
}

describe('saveCloudOnboardingGoalFn enables the goal modules', () => {
  function cloudRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'workspace_1',
      name: 'Acme',
      slug: 'acme',
      managedFieldPaths: [],
      cloudIdentity: CLOUD_IDENTITY,
      featureFlags: JSON.stringify(DEFAULT_FEATURE_FLAGS),
      setupState: JSON.stringify({
        version: 2,
        steps: { core: true, workspace: true, startingPoint: null },
        useCase: null,
        workspaceDetailsSeenAt: '2026-08-14T11:00:00.000Z',
      }),
      ...overrides,
    }
  }

  it('turns Help Center on when a cloud workspace picks that goal', async () => {
    hoisted.getSettings.mockResolvedValue(cloudRow())
    hoisted.principalFindFirst.mockResolvedValue({ id: 'principal_1', role: 'admin' })

    const result = await saveCloudOnboardingGoalFn({ data: { useCase: 'help_center' } })

    expect(result).toEqual({ useCase: 'help_center', enabledModules: ['Help Center'] })
    const written = hoisted.flagWrites.find((values) => typeof values.featureFlags === 'string')
    expect(written).toBeDefined()
    const flags = resolveFeatureFlags(written!.featureFlags as string)
    expect(flags.helpCenter).toBe(true)
    expect(flags.supportInbox).toBe(false)
  })

  it('turns Support on for customer support without turning Help Center off', async () => {
    hoisted.getSettings.mockResolvedValue(
      cloudRow({
        featureFlags: JSON.stringify({ ...DEFAULT_FEATURE_FLAGS, helpCenter: true }),
      })
    )
    hoisted.principalFindFirst.mockResolvedValue({ id: 'principal_1', role: 'admin' })

    const result = await saveCloudOnboardingGoalFn({ data: { useCase: 'customer_support' } })

    expect(result.enabledModules).toEqual(['Support'])
    const written = hoisted.flagWrites.find((values) => typeof values.featureFlags === 'string')
    const flags = resolveFeatureFlags(written!.featureFlags as string)
    expect(flags.supportInbox).toBe(true)
    expect(flags.supportTickets).toBe(true)
    expect(flags.helpCenter).toBe(true)
  })
})
