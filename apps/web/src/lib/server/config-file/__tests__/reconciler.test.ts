import { describe, expect, it, vi } from 'vitest'
import { mergeSetupState, reconcileFileIntoDb, type ReconcileDeps } from '../reconciler'
import type { SetupState } from '@/lib/shared/db-types'

const incompleteState = (overrides: Partial<SetupState> = {}): SetupState => ({
  version: 2,
  steps: { core: true, workspace: false, startingPoint: null },
  ...overrides,
})

const baseDeps = (): ReconcileDeps => ({
  readSettings: vi.fn(async () => ({
    id: 'ws_1',
    name: 'Old',
    slug: 'old',
    setupState: JSON.stringify(incompleteState()),
    tierLimits: null,
    managedFieldPaths: [],
  })),
  updateSettings: vi.fn(async () => {}),
  createSettings: vi.fn(async () => {}),
  invalidateSettingsCache: vi.fn(async () => {}),
  invalidateTierLimitsCache: vi.fn(async () => {}),
})

describe('reconcileFileIntoDb', () => {
  it('writes workspace fields and records the config intent for the locked state update', async () => {
    const deps = baseDeps()
    await reconcileFileIntoDb(
      { workspace: { name: 'Acme', slug: 'acme', useCase: 'customer_support' } },
      deps
    )

    const update = (deps.updateSettings as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    expect(update).toEqual(
      expect.objectContaining({
        name: 'Acme',
        slug: 'acme',
        setupWorkspace: { name: 'Acme', slug: 'acme', useCase: 'customer_support' },
        managedFieldPaths: ['workspace.name', 'workspace.slug', 'workspace.useCase'],
      })
    )
    expect(update).not.toHaveProperty('setupState')
  })

  it.each([{ name: 'Acme' }, { slug: 'acme' }])(
    'marks the workspace step complete for a partial managed workspace: %o',
    (workspace) => {
      const next = mergeSetupState(JSON.stringify(incompleteState()), workspace)
      expect(next.steps.workspace).toBe(true)
      expect(next.steps.startingPoint).toBeNull()
    }
  )

  it('completes every setup step when onboardingComplete is managed', () => {
    const next = mergeSetupState(JSON.stringify(incompleteState({ useCase: 'help_center' })), {
      onboardingComplete: true,
    })

    expect(next.version).toBe(2)
    expect(next.steps.core).toBe(true)
    expect(next.steps.workspace).toBe(true)
    expect(next.steps.startingPoint).toEqual(
      expect.objectContaining({
        outcome: 'help_center',
        resourceType: 'none',
        source: 'managed',
        resolution: 'configured',
      })
    )
    expect(next.completedAt).toEqual(expect.any(String))
    expect(next.completionSource).toBe('managed')
  })

  it('preserves completion, handoff and task-resolution state across reconciliation', () => {
    const completedAt = '2026-01-01T00:00:00.000Z'
    const next = mergeSetupState(
      JSON.stringify(
        incompleteState({
          useCase: 'product_feedback',
          completedAt,
          completionSource: 'wizard',
          activationHandoffSeenAt: '2026-01-02T00:00:00.000Z',
          taskResolutions: {
            product_feedback: {
              'add-to-site': { resolution: 'deferred', resolvedAt: completedAt },
              'customize-branding': { resolution: 'dismissed', resolvedAt: completedAt },
            },
          },
        })
      ),
      { name: 'Acme' }
    )

    expect(next.completedAt).toBe(completedAt)
    expect(next.completionSource).toBe('wizard')
    expect(next.activationHandoffSeenAt).toBe('2026-01-02T00:00:00.000Z')
    expect(next.taskResolutions).toEqual({
      product_feedback: {
        'add-to-site': { resolution: 'deferred', resolvedAt: completedAt },
        'customize-branding': { resolution: 'dismissed', resolvedAt: completedAt },
      },
    })
  })

  it('does not create a starting point unless onboardingComplete is set', () => {
    const next = mergeSetupState(JSON.stringify(incompleteState()), {
      name: 'Acme',
      useCase: 'internal',
    })
    expect(next.steps.startingPoint).toBeNull()
    expect(next.completedAt).toBeUndefined()
    expect(next.useCase).toBe('internal')
  })

  it('writes tier limits as JSON', async () => {
    const deps = baseDeps()
    await reconcileFileIntoDb({ tierLimits: { maxBoards: 7 } }, deps)
    const update = (deps.updateSettings as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    expect(JSON.parse(update.tierLimits as string)).toEqual({ maxBoards: 7 })
    expect(update.managedFieldPaths).toEqual(['tierLimits'])
  })

  it('ignores deprecated auth and features keys', async () => {
    const deps = baseDeps()
    await reconcileFileIntoDb(
      {
        workspace: { name: 'Acme' },
        tierLimits: { maxBoards: 3 },
        auth: { oauth: { google: true } },
        features: { helpCenter: true },
      },
      deps
    )
    const update = (deps.updateSettings as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    expect(update.name).toBe('Acme')
    expect(JSON.parse(update.tierLimits as string)).toEqual({ maxBoards: 3 })
    expect(update.managedFieldPaths).toEqual(['workspace.name', 'tierLimits'])
    expect(update).not.toHaveProperty('authConfig')
    expect(update).not.toHaveProperty('featureFlags')
  })

  it('clears managed paths when the config is emptied', async () => {
    const deps = baseDeps()
    deps.readSettings = vi.fn(async () => ({
      id: 'ws_1',
      name: 'X',
      slug: 'x',
      setupState: null,
      tierLimits: null,
      managedFieldPaths: ['tierLimits', 'workspace.name'],
    }))
    await reconcileFileIntoDb({}, deps)
    const update = (deps.updateSettings as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    expect(update.managedFieldPaths).toEqual([])
  })

  it('invalidates settings and tier caches after a write', async () => {
    const deps = baseDeps()
    await reconcileFileIntoDb({ tierLimits: { maxBoards: 1 } }, deps)
    expect(deps.invalidateSettingsCache).toHaveBeenCalledOnce()
    expect(deps.invalidateTierLimitsCache).toHaveBeenCalledOnce()
  })

  it('skips a no-op reconcile', async () => {
    const deps = baseDeps()
    deps.readSettings = vi.fn(async () => ({
      id: 'ws_1',
      name: 'Acme',
      slug: 'acme',
      setupState: JSON.stringify(
        incompleteState({ steps: { core: true, workspace: true, startingPoint: null } })
      ),
      tierLimits: null,
      managedFieldPaths: ['workspace.name', 'workspace.slug'],
    }))
    await reconcileFileIntoDb({ workspace: { name: 'Acme', slug: 'acme' } }, deps)
    expect(deps.updateSettings).not.toHaveBeenCalled()
  })

  it('creates a V2 settings row when the config provides a name and slug', async () => {
    const deps = baseDeps()
    deps.readSettings = vi.fn(async () => null)
    await reconcileFileIntoDb({ workspace: { name: 'Acme', slug: 'acme' } }, deps)

    expect(deps.createSettings).toHaveBeenCalledOnce()
    expect(deps.updateSettings).not.toHaveBeenCalled()
    const insert = (deps.createSettings as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    const setup = JSON.parse(insert.setupState as string)
    expect(insert).toEqual(
      expect.objectContaining({
        name: 'Acme',
        slug: 'acme',
        managedFieldPaths: ['workspace.name', 'workspace.slug'],
      })
    )
    expect(setup).toEqual(
      expect.objectContaining({
        version: 2,
        steps: { core: true, workspace: true, startingPoint: null },
      })
    )
    expect(deps.invalidateSettingsCache).toHaveBeenCalledOnce()
    expect(deps.invalidateTierLimitsCache).toHaveBeenCalledOnce()
  })

  it.each([{ tierLimits: { maxBoards: 5 } }, { workspace: { name: 'Acme' } }])(
    'does not create an incomplete settings row: %o',
    async (spec) => {
      const deps = baseDeps()
      deps.readSettings = vi.fn(async () => null)
      await reconcileFileIntoDb(spec, deps)
      expect(deps.createSettings).not.toHaveBeenCalled()
    }
  )
})
