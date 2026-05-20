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
    featureFlags: null,
    authConfig: null,
    managedFieldPaths: [],
    state: 'active' as const,
  })),
  updateSettings: vi.fn(async () => {}),
  createSettings: vi.fn(async () => {}),
  invalidateSettingsCache: vi.fn(async () => {}),
  invalidateTierLimitsCache: vi.fn(async () => {}),
  resetAuth: vi.fn(async () => {}),
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
      featureFlags: null,
      authConfig: null,
      managedFieldPaths: ['workspace.name', 'workspace.slug'],
      state: 'active' as const,
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

  it('per-key merges features over existing flags', async () => {
    const deps = baseDeps()
    deps.readSettings = vi.fn(async () => ({
      id: 'ws_1',
      name: 'X',
      slug: 'x',
      setupState: null,
      tierLimits: null,
      featureFlags: JSON.stringify({ helpCenter: false, other: true }),
      authConfig: null,
      managedFieldPaths: [],
      state: 'active' as const,
    }))
    await reconcileFileIntoDb({ features: { helpCenter: true } }, deps)
    const arg = (deps.updateSettings as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    expect(JSON.parse(arg.featureFlags as string)).toEqual({ helpCenter: true, other: true })
    expect(arg.managedFieldPaths).toEqual(['features.helpCenter'])
  })

  it('clears managedFieldPaths when called with an empty spec', async () => {
    const deps = baseDeps()
    deps.readSettings = vi.fn(async () => ({
      id: 'ws_1',
      name: 'X',
      slug: 'x',
      setupState: null,
      tierLimits: null,
      featureFlags: null,
      authConfig: null,
      managedFieldPaths: ['tierLimits', 'workspace.name'],
      state: 'active' as const,
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

  it('calls resetAuth when features are managed (auth plugins gate on flags)', async () => {
    const deps = baseDeps()
    await reconcileFileIntoDb({ features: { helpCenter: true } }, deps)
    expect(deps.resetAuth).toHaveBeenCalledTimes(1)
  })

  it('does NOT call resetAuth when only tierLimits change', async () => {
    const deps = baseDeps()
    await reconcileFileIntoDb({ tierLimits: { maxBoards: 1 } }, deps)
    expect(deps.resetAuth).not.toHaveBeenCalled()
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
      featureFlags: null,
      authConfig: null,
      managedFieldPaths: ['workspace.name', 'workspace.slug'],
      state: 'active' as const,
    }))
    await reconcileFileIntoDb({ workspace: { name: 'Acme', slug: 'acme' } }, deps)
    expect(deps.updateSettings).not.toHaveBeenCalled()
  })

  it('writes state when spec.state is set', async () => {
    const deps = baseDeps()
    await reconcileFileIntoDb({ state: 'suspended' }, deps)
    const arg = (deps.updateSettings as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    expect(arg.state).toBe('suspended')
    expect(arg.managedFieldPaths).toEqual(['state'])
  })

  it('per-key merges auth.oauth over existing config', async () => {
    const deps = baseDeps()
    deps.readSettings = vi.fn(async () => ({
      id: 'ws_1',
      name: 'X',
      slug: 'x',
      setupState: null,
      tierLimits: null,
      featureFlags: null,
      authConfig: JSON.stringify({
        oauth: { google: false, github: true },
        openSignup: true,
      }),
      managedFieldPaths: [],
      state: 'active' as const,
    }))
    await reconcileFileIntoDb({ auth: { oauth: { google: true } } }, deps)
    const arg = (deps.updateSettings as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    const merged = JSON.parse(arg.authConfig as string)
    expect(merged.oauth).toEqual({ google: true, github: true })
    expect(merged.openSignup).toBe(true)
    expect(arg.managedFieldPaths).toEqual(['auth.oauth.google'])
    expect(deps.resetAuth).toHaveBeenCalled()
  })

  it('writes openSignup leaf without nuking existing oauth providers', async () => {
    const deps = baseDeps()
    deps.readSettings = vi.fn(async () => ({
      id: 'ws_1',
      name: 'X',
      slug: 'x',
      setupState: null,
      tierLimits: null,
      featureFlags: null,
      authConfig: JSON.stringify({
        oauth: { google: true, github: true },
        openSignup: false,
      }),
      managedFieldPaths: [],
      state: 'active' as const,
    }))
    await reconcileFileIntoDb({ auth: { openSignup: true } }, deps)
    const arg = (deps.updateSettings as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    const merged = JSON.parse(arg.authConfig as string)
    expect(merged.oauth).toEqual({ google: true, github: true })
    expect(merged.openSignup).toBe(true)
    expect(arg.managedFieldPaths).toEqual(['auth.openSignup'])
    expect(deps.resetAuth).toHaveBeenCalled()
  })

  it('does NOT call resetAuth when only tierLimits change (auth-untouched path)', async () => {
    const deps = baseDeps()
    await reconcileFileIntoDb({ tierLimits: { maxBoards: 1 } }, deps)
    expect(deps.resetAuth).not.toHaveBeenCalled()
  })

  it('writes ssoOidc into settings.authConfig + triggers resetAuth', async () => {
    const deps = baseDeps()
    await reconcileFileIntoDb(
      {
        auth: {
          ssoOidc: {
            enabled: true,
            discoveryUrl: 'https://idp.example.com/.well-known/openid-configuration',
            clientId: 'workspace-x',
            autoCreateUsers: true,
          },
        },
      },
      deps
    )
    const arg = (deps.updateSettings as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    const merged = JSON.parse(arg.authConfig as string)
    expect(merged.ssoOidc.clientId).toBe('workspace-x')
    expect(merged.ssoOidc.enabled).toBe(true)
    expect(arg.managedFieldPaths).toEqual([
      'auth.ssoOidc.enabled',
      'auth.ssoOidc.discoveryUrl',
      'auth.ssoOidc.clientId',
      'auth.ssoOidc.autoCreateUsers',
    ])
    expect(deps.resetAuth).toHaveBeenCalled()
  })

  it('per-key merges ssoOidc over the existing block', async () => {
    const deps = baseDeps()
    deps.readSettings = vi.fn(async () => ({
      id: 'ws_1',
      name: 'X',
      slug: 'x',
      setupState: null,
      tierLimits: null,
      featureFlags: null,
      authConfig: JSON.stringify({
        oauth: { google: true },
        openSignup: false,
        ssoOidc: {
          enabled: false,
          discoveryUrl: 'https://old.example.com/.well-known/openid-configuration',
          clientId: 'old-id',
          autoCreateUsers: false,
        },
      }),
      managedFieldPaths: [],
      state: 'active' as const,
    }))
    // File flips enabled=true and bumps the clientId; everything else
    // in the existing block (discoveryUrl, autoCreateUsers, ...) is
    // unchanged — per-key merges let the file lock individual fields
    // without nuking siblings.
    await reconcileFileIntoDb(
      {
        auth: {
          ssoOidc: {
            enabled: true,
            discoveryUrl: 'https://old.example.com/.well-known/openid-configuration',
            clientId: 'new-id',
            autoCreateUsers: false,
          },
        },
      },
      deps
    )
    const arg = (deps.updateSettings as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    const merged = JSON.parse(arg.authConfig as string)
    expect(merged.ssoOidc.enabled).toBe(true)
    expect(merged.ssoOidc.clientId).toBe('new-id')
    expect(merged.ssoOidc.autoCreateUsers).toBe(false)
    // oauth block stays intact when only ssoOidc is in the spec
    expect(merged.oauth).toEqual({ google: true })
  })

  it('creates a settings row when none exists and spec has workspace.name + slug', async () => {
    const deps = baseDeps()
    deps.readSettings = vi.fn(async () => null)
    await reconcileFileIntoDb({ workspace: { name: 'Acme', slug: 'acme' }, state: 'active' }, deps)
    expect(deps.createSettings).toHaveBeenCalledTimes(1)
    expect(deps.updateSettings).not.toHaveBeenCalled()
    const arg = (deps.createSettings as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    expect(arg).toEqual(
      expect.objectContaining({
        name: 'Acme',
        slug: 'acme',
        state: 'active',
        managedFieldPaths: ['workspace.name', 'workspace.slug', 'state'],
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

  it('serializes tierLimits + features + auth on create', async () => {
    const deps = baseDeps()
    deps.readSettings = vi.fn(async () => null)
    await reconcileFileIntoDb(
      {
        workspace: { name: 'Acme', slug: 'acme' },
        tierLimits: { maxBoards: 7 },
        features: { helpCenter: true },
        auth: { oauth: { google: true }, openSignup: false },
      },
      deps
    )
    const arg = (deps.createSettings as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    expect(JSON.parse(arg.tierLimits as string)).toEqual({ maxBoards: 7 })
    expect(JSON.parse(arg.featureFlags as string)).toEqual({ helpCenter: true })
    const auth = JSON.parse(arg.authConfig as string)
    expect(auth.oauth).toEqual({ google: true })
    expect(auth.openSignup).toBe(false)
    // resetAuth fires because both auth + features changed
    expect(deps.resetAuth).toHaveBeenCalledTimes(1)
  })

  it('defaults state to active on create when spec.state is omitted', async () => {
    const deps = baseDeps()
    deps.readSettings = vi.fn(async () => null)
    await reconcileFileIntoDb({ workspace: { name: 'Acme', slug: 'acme' } }, deps)
    const arg = (deps.createSettings as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    expect(arg.state).toBe('active')
  })

  it('sanitizes malformed authConfig JSON instead of propagating it', async () => {
    const deps = baseDeps()
    deps.readSettings = vi.fn(async () => ({
      id: 'ws_1',
      name: 'X',
      slug: 'x',
      setupState: null,
      tierLimits: null,
      featureFlags: null,
      // oauth is a string, openSignup is a number — both need to be
      // discarded rather than written back to the column.
      authConfig: JSON.stringify({ oauth: 'not-an-object', openSignup: 42 }),
      managedFieldPaths: [],
      state: 'active' as const,
    }))
    await reconcileFileIntoDb({ auth: { oauth: { google: true } } }, deps)
    const arg = (deps.updateSettings as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    const merged = JSON.parse(arg.authConfig as string)
    expect(merged.oauth).toEqual({ google: true })
    expect(merged.openSignup).toBe(false)
  })
})
