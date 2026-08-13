/**
 * The declarative config file is the first writer of the cloud block. It has
 * to reach plan and entitlements exactly as it already reaches tier limits,
 * without acquiring the whole block and shutting the second writer out.
 */
import { describe, expect, it, vi } from 'vitest'
import { parseQuackbackConfig } from '../schema'
import { computeManagedPaths } from '../managed-paths'
import { reconcileFileIntoDb, type ReconcileDeps } from '../reconciler'

const baseDeps = (): ReconcileDeps => ({
  readSettings: vi.fn(async () => ({
    id: 'ws_1',
    name: 'Acme',
    slug: 'acme',
    setupState: null,
    tierLimits: null,
    cloud: null,
    managedFieldPaths: [],
  })),
  updateSettings: vi.fn(async () => {}),
  createSettings: vi.fn(async () => {}),
  applyCloudConfig: vi.fn(async () => true),
  applyTierLimits: vi.fn(async () => true),
  invalidateSettingsCache: vi.fn(async () => {}),
  invalidateTierLimitsCache: vi.fn(async () => {}),
})

function lastUpdate(deps: ReconcileDeps) {
  return (deps.updateSettings as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
}

/**
 * The patch the reconciler handed to the cloud write seam.
 *
 * The reconciler no longer computes a merged block and puts it in the column
 * update: `settings.cloud` has a second writer, so the merge has to happen
 * inside that writer's row lock or one of them is silently lost. What the
 * reconciler produces now is the PATCH; the merge is asserted against a real
 * database in `cloud/__tests__/cloud-concurrency.test.ts`.
 */
function lastCloudPatch(deps: ReconcileDeps) {
  return (deps.applyCloudConfig as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
}

const envelope = (spec: unknown) => ({
  apiVersion: 'quackback.io/v1',
  kind: 'QuackbackConfig',
  spec,
})

describe('config-file schema: spec.cloud', () => {
  it('accepts a full cloud block', () => {
    const result = parseQuackbackConfig(
      envelope({
        cloud: {
          enabled: true,
          plan: 'scale',
          entitlements: { sso: true, auditLog: false },
          billing: { provider: 'acme', customerRef: 'cus_1', status: 'active' },
          upgradeUrl: 'https://example.com/billing',
        },
      })
    )
    expect(result.success).toBe(true)
  })

  it('accepts an explicitly inert block', () => {
    expect(parseQuackbackConfig(envelope({ cloud: { enabled: false } })).success).toBe(true)
  })

  it('rejects enabling without naming a plan', () => {
    // Otherwise the workspace lands in the fail-closed "enabled, no plan"
    // state, where everything is denied and nothing can be upsold. Unreachable
    // through the supported writer by construction.
    expect(parseQuackbackConfig(envelope({ cloud: { enabled: true } })).success).toBe(false)
    expect(parseQuackbackConfig(envelope({ cloud: { enabled: true, plan: null } })).success).toBe(
      false
    )
  })

  it('rejects an unknown plan, entitlement or billing status', () => {
    expect(
      parseQuackbackConfig(envelope({ cloud: { enabled: true, plan: 'platinum' } })).success
    ).toBe(false)
    expect(
      parseQuackbackConfig(
        envelope({ cloud: { enabled: true, plan: 'pro', entitlements: { timeTravel: true } } })
      ).success
    ).toBe(false)
    expect(
      parseQuackbackConfig(
        envelope({ cloud: { enabled: true, plan: 'pro', billing: { status: 'refunding' } } })
      ).success
    ).toBe(false)
  })

  it.each(['business', 'enterprise'])('rejects the retired plan id %s', (plan) => {
    // These named plans in an earlier catalogue. A config file still carrying
    // one must fail loudly rather than be silently reinterpreted, which is
    // what makes a stale file recoverable instead of quietly wrong.
    expect(parseQuackbackConfig(envelope({ cloud: { enabled: true, plan } })).success).toBe(false)
  })

  it('rejects a non-https upgrade link', () => {
    expect(
      parseQuackbackConfig(
        envelope({ cloud: { enabled: true, plan: 'pro', upgradeUrl: 'http://example.com' } })
      ).success
    ).toBe(false)
  })

  it('leaves a file with no cloud block undeclared', () => {
    const result = parseQuackbackConfig(envelope({ workspace: { name: 'Acme' } }))
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.spec.cloud).toBeUndefined()
  })
})

describe('managed paths for the cloud block', () => {
  it('claims leaf paths, never the whole block', () => {
    expect(computeManagedPaths({ cloud: { enabled: true, plan: 'pro' } })).toEqual([
      'cloud.enabled',
      'cloud.plan',
    ])
  })

  it('claims only what the file declares, leaving the rest to the other writer', () => {
    expect(computeManagedPaths({ cloud: { enabled: true, plan: 'pro' } })).not.toContain(
      'cloud.billing'
    )
    expect(
      computeManagedPaths({ cloud: { enabled: false, billing: { provider: 'acme' } } })
    ).toEqual(['cloud.enabled', 'cloud.billing'])
  })

  it('adds nothing when the file has no cloud block', () => {
    expect(computeManagedPaths({ workspace: { name: 'Acme' } })).toEqual(['workspace.name'])
    expect(computeManagedPaths({})).toEqual([])
  })
})

describe('reconcileFileIntoDb — cloud block', () => {
  it('hands the declared block to the cloud write seam, not to the column update', async () => {
    const deps = baseDeps()
    await reconcileFileIntoDb(
      { cloud: { enabled: true, plan: 'pro', entitlements: { sso: true } } },
      deps
    )
    expect(lastCloudPatch(deps)).toEqual({
      enabled: true,
      plan: 'pro',
      entitlements: { sso: true },
    })
    // The column update must NOT carry cloud: a `SET cloud = <merged>`
    // computed from a row read earlier in the function is exactly the write
    // that loses the billing writer's update.
    expect(lastUpdate(deps)).not.toHaveProperty('cloud')
    expect(lastUpdate(deps).managedFieldPaths).toEqual([
      'cloud.enabled',
      'cloud.plan',
      'cloud.entitlements',
    ])
  })

  it('declares only the plan, so the seam has nothing with which to clobber a billing reference', async () => {
    const deps = baseDeps()
    deps.readSettings = vi.fn(async () => ({
      id: 'ws_1',
      name: 'Acme',
      slug: 'acme',
      setupState: null,
      tierLimits: null,
      cloud: {
        enabled: true,
        plan: 'pro',
        billing: { provider: 'acme', subscriptionRef: 'sub_1' },
        source: 'billing' as const,
      },
      managedFieldPaths: [],
    }))
    await reconcileFileIntoDb({ cloud: { enabled: true, plan: 'scale' } }, deps)
    const patch = lastCloudPatch(deps)
    expect(patch).toEqual({ enabled: true, plan: 'scale' })
    // The absence is the assertion: a patch with no `billing` key cannot
    // overwrite a stored one, whatever the merge does with it.
    expect(patch).not.toHaveProperty('billing')
  })

  it('skips the write when the file restates what is already stored', async () => {
    // Guards the 30-second poll: without stamp-insensitive comparison every
    // tick would rewrite the row and bust the settings cache forever.
    const deps = baseDeps()
    deps.readSettings = vi.fn(async () => ({
      id: 'ws_1',
      name: 'Acme',
      slug: 'acme',
      setupState: null,
      tierLimits: null,
      cloud: {
        enabled: true,
        plan: 'pro',
        entitlements: {},
        billing: {},
        source: 'config' as const,
        updatedAt: '2020-01-01T00:00:00.000Z',
      },
      managedFieldPaths: ['cloud.enabled', 'cloud.plan'],
    }))
    await reconcileFileIntoDb({ cloud: { enabled: true, plan: 'pro' } }, deps)
    expect(deps.updateSettings).not.toHaveBeenCalled()
    // The seam is idempotent too, but the reconciler must not even open a
    // locking transaction on a steady-state tick.
    expect(deps.applyCloudConfig).not.toHaveBeenCalled()
  })

  it('seeds the cloud block on a fresh install', async () => {
    const deps = baseDeps()
    deps.readSettings = vi.fn(async () => null)
    await reconcileFileIntoDb(
      { workspace: { name: 'Acme', slug: 'acme' }, cloud: { enabled: true, plan: 'pro' } },
      deps
    )
    const insert = (deps.createSettings as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    expect(insert.cloud).toEqual(expect.objectContaining({ enabled: true, plan: 'pro' }))
  })

  it('leaves the column untouched when the file has no cloud block', async () => {
    const deps = baseDeps()
    await reconcileFileIntoDb({ tierLimits: { maxBoards: 3 } }, deps)
    expect(lastUpdate(deps)).not.toHaveProperty('cloud')
    expect(deps.applyCloudConfig).not.toHaveBeenCalled()
  })

  it('leaves the column untouched on a fresh install with no cloud block', async () => {
    const deps = baseDeps()
    deps.readSettings = vi.fn(async () => null)
    await reconcileFileIntoDb({ workspace: { name: 'Acme', slug: 'acme' } }, deps)
    const insert = (deps.createSettings as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    expect(insert.cloud).toBeUndefined()
  })

  it('unlocks the paths when the block is removed from the file', async () => {
    const deps = baseDeps()
    deps.readSettings = vi.fn(async () => ({
      id: 'ws_1',
      name: 'Acme',
      slug: 'acme',
      setupState: null,
      tierLimits: null,
      cloud: { enabled: true, plan: 'pro' },
      managedFieldPaths: ['cloud.enabled', 'cloud.plan'],
    }))
    await reconcileFileIntoDb({}, deps)
    const update = lastUpdate(deps)
    expect(update.managedFieldPaths).toEqual([])
    // Deliberately does NOT clear the stored plan. Removing a lock from the
    // file releases the UI, it does not silently downgrade the workspace.
    expect(update).not.toHaveProperty('cloud')
  })
})
