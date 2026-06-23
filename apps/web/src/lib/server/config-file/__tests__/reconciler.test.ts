import { describe, it, expect, vi } from 'vitest'
import { reconcileFileIntoDb, type ReconcileDeps } from '../reconciler'

const baseDeps = (): ReconcileDeps => ({
  readSettings: vi.fn(async () => ({
    id: 'ws_1',
    name: 'Old',
    slug: 'old',
    setupState: JSON.stringify({
      version: 1,
      steps: { core: true, workspace: false, boards: false },
    }),
    tierLimits: null,
    managedFieldPaths: [],
  })),
  updateSettings: vi.fn(async () => {}),
  createSettings: vi.fn(async () => {}),
  invalidateSettingsCache: vi.fn(async () => {}),
  invalidateTierLimitsCache: vi.fn(async () => {}),
})

describe('reconcileFileIntoDb', () => {
  it('writes name + slug + managedFieldPaths when workspace is in spec', async () => {
    const deps = baseDeps()
    await reconcileFileIntoDb({ workspace: { name: 'Acme', slug: 'acme' } }, deps)
    expect(deps.updateSettings).toHaveBeenCalledTimes(1)
    const arg = (deps.updateSettings as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    expect(arg.name).toBe('Acme')
    expect(arg.slug).toBe('acme')
    expect(arg.managedFieldPaths).toEqual(['workspace.name', 'workspace.slug'])
  })

  it('marks setupState.steps.workspace=true when workspace.name is managed', async () => {
    const deps = baseDeps()
    await reconcileFileIntoDb({ workspace: { name: 'Acme' } }, deps)
    const arg = (deps.updateSettings as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    const setup = JSON.parse(arg.setupState as string)
    expect(setup.steps.workspace).toBe(true)
  })

  it('marks setupState.steps.workspace=true when ONLY workspace.slug is managed', async () => {
    const deps = baseDeps()
    await reconcileFileIntoDb({ workspace: { slug: 'acme' } }, deps)
    const arg = (deps.updateSettings as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    const setup = JSON.parse(arg.setupState as string)
    expect(setup.steps.workspace).toBe(true)
  })

  it('forces every setupState step + stamps completedAt when workspace.onboardingComplete=true', async () => {
    const deps = baseDeps()
    await reconcileFileIntoDb(
      { workspace: { name: 'Acme', slug: 'acme', onboardingComplete: true } },
      deps
    )
    const arg = (deps.updateSettings as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    const setup = JSON.parse(arg.setupState as string)
    expect(setup.steps).toEqual({ core: true, workspace: true, boards: true })
    expect(typeof setup.completedAt).toBe('string')
    expect(new Date(setup.completedAt).toString()).not.toBe('Invalid Date')
  })

  it('preserves an existing completedAt rather than re-stamping on every reconcile', async () => {
    const deps = baseDeps()
    const stamped = '2026-01-01T00:00:00.000Z'
    deps.readSettings = vi.fn(async () => ({
      id: 'ws_1',
      name: 'Acme',
      slug: 'acme',
      setupState: JSON.stringify({
        version: 1,
        steps: { core: true, workspace: true, boards: true },
        completedAt: stamped,
      }),
      tierLimits: null,
      managedFieldPaths: ['workspace.name', 'workspace.slug'],
    }))
    await reconcileFileIntoDb(
      { workspace: { name: 'Acme', slug: 'acme', onboardingComplete: true } },
      deps
    )
    // The reconciler should detect a no-op and skip updateSettings entirely.
    expect(deps.updateSettings).not.toHaveBeenCalled()
  })

  it('does NOT force boards step when workspace.onboardingComplete is absent', async () => {
    const deps = baseDeps()
    await reconcileFileIntoDb({ workspace: { name: 'Acme', slug: 'acme' } }, deps)
    const arg = (deps.updateSettings as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    const setup = JSON.parse(arg.setupState as string)
    expect(setup.steps.boards).toBe(false)
    expect(setup.completedAt).toBeUndefined()
  })

  it('writes tierLimits as a JSON-encoded string', async () => {
    const deps = baseDeps()
    await reconcileFileIntoDb({ tierLimits: { maxBoards: 7 } }, deps)
    const arg = (deps.updateSettings as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    expect(JSON.parse(arg.tierLimits as string)).toEqual({ maxBoards: 7 })
    expect(arg.managedFieldPaths).toEqual(['tierLimits'])
  })

  it('clears managedFieldPaths when called with an empty spec', async () => {
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
    const arg = (deps.updateSettings as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    expect(arg.managedFieldPaths).toEqual([])
  })

  it('invalidates settings + tier-limits caches after every reconcile', async () => {
    const deps = baseDeps()
    await reconcileFileIntoDb({ tierLimits: { maxBoards: 1 } }, deps)
    expect(deps.invalidateSettingsCache).toHaveBeenCalledTimes(1)
    expect(deps.invalidateTierLimitsCache).toHaveBeenCalledTimes(1)
  })

  it('skips updateSettings when nothing has changed', async () => {
    const deps = baseDeps()
    deps.readSettings = vi.fn(async () => ({
      id: 'ws_1',
      name: 'Acme',
      slug: 'acme',
      setupState: JSON.stringify({
        version: 1,
        steps: { core: true, workspace: true, boards: false },
      }),
      tierLimits: null,
      managedFieldPaths: ['workspace.name', 'workspace.slug'],
    }))
    await reconcileFileIntoDb({ workspace: { name: 'Acme', slug: 'acme' } }, deps)
    expect(deps.updateSettings).not.toHaveBeenCalled()
  })

  it('creates a settings row when none exists and spec has workspace.name + slug', async () => {
    const deps = baseDeps()
    deps.readSettings = vi.fn(async () => null)
    await reconcileFileIntoDb({ workspace: { name: 'Acme', slug: 'acme' } }, deps)
    expect(deps.createSettings).toHaveBeenCalledTimes(1)
    expect(deps.updateSettings).not.toHaveBeenCalled()
    const arg = (deps.createSettings as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    expect(arg).toEqual(
      expect.objectContaining({
        name: 'Acme',
        slug: 'acme',
        managedFieldPaths: ['workspace.name', 'workspace.slug'],
      })
    )
    // setupState marks workspace step done because the file declares it
    const setup = JSON.parse(arg.setupState as string)
    expect(setup.steps.workspace).toBe(true)
    // Cache invalidations fire after a successful insert
    expect(deps.invalidateSettingsCache).toHaveBeenCalledTimes(1)
    expect(deps.invalidateTierLimitsCache).toHaveBeenCalledTimes(1)
  })

  it('skips create when spec is missing workspace.name or slug', async () => {
    const deps = baseDeps()
    deps.readSettings = vi.fn(async () => null)
    await reconcileFileIntoDb({ tierLimits: { maxBoards: 5 } }, deps)
    expect(deps.createSettings).not.toHaveBeenCalled()
    expect(deps.updateSettings).not.toHaveBeenCalled()
  })

  it('skips create when only workspace.name is present (slug missing)', async () => {
    const deps = baseDeps()
    deps.readSettings = vi.fn(async () => null)
    await reconcileFileIntoDb({ workspace: { name: 'Acme' } }, deps)
    expect(deps.createSettings).not.toHaveBeenCalled()
  })
})
