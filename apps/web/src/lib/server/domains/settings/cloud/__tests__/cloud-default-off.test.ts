/**
 * The default-off proof.
 *
 * The claim under test is that an install with no cloud config behaves exactly
 * as it did before this block existed: unlimited, no plan, no gating, no
 * upsell. These tests demonstrate that rather than asserting it — every case
 * below iterates the live catalogue (`ENTITLEMENT_KEYS`), so an entitlement
 * added later is covered automatically instead of being quietly forgotten.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { StoredCloudConfig } from '@/lib/shared/db-types'
import { DISABLED_CLOUD_CONFIG, ENTITLEMENT_KEYS, PLAN_IDS, type CloudConfig } from '../cloud.types'
import { resolveCloudConfig } from '../cloud.service'
import { isEntitled } from '../entitlements'

const hoisted = vi.hoisted(() => ({ mockGetWorkspaceSettings: vi.fn() }))

vi.mock('../../settings.service', () => ({
  getTenantSettings: hoisted.mockGetWorkspaceSettings,
}))

describe('resolveCloudConfig — every "not configured" input resolves to disabled', () => {
  // Each entry is a shape a real deployment can produce: a fresh row (null), a
  // row written by an older writer, a row a human edited, a row from a newer
  // schema this code version does not understand.
  const inertInputs: Array<[string, unknown]> = [
    ['NULL column (the migration default)', null],
    ['undefined', undefined],
    ['empty object', {}],
    ['explicit enabled:false', { enabled: false }],
    [
      'enabled:false with a plan and denials',
      {
        enabled: false,
        plan: 'free',
        entitlements: Object.fromEntries(ENTITLEMENT_KEYS.map((k) => [k, false])),
        futureCommercialState: { opaque: true },
      },
    ],
    ['a truthy-but-not-true enabled', { enabled: 1 }],
    ['a string masquerading as a config', 'enabled'],
    ['an array', []],
    ['a future shape with unknown keys', { mode: 'metered', tier: 'gold' }],
  ]

  it.each(inertInputs)('%s -> DISABLED_CLOUD_CONFIG', (_label, input) => {
    expect(resolveCloudConfig(input as StoredCloudConfig | null)).toEqual(DISABLED_CLOUD_CONFIG)
  })

  it('the disabled default itself is frozen, so no caller can turn gating on by mutation', () => {
    expect(Object.isFrozen(DISABLED_CLOUD_CONFIG)).toBe(true)
    expect(Object.isFrozen(DISABLED_CLOUD_CONFIG.entitlements)).toBe(true)
  })

  it('describes an install with no plan or commercial actions', () => {
    expect(DISABLED_CLOUD_CONFIG.enabled).toBe(false)
    expect(DISABLED_CLOUD_CONFIG.plan).toBeNull()
    expect(DISABLED_CLOUD_CONFIG.entitlements).toEqual({})
    expect(DISABLED_CLOUD_CONFIG.subscriptionStatus).toBeNull()
    expect(DISABLED_CLOUD_CONFIG.canUpgrade).toBe(false)
    expect(DISABLED_CLOUD_CONFIG.canManageBilling).toBe(false)
  })
})

describe('every entitlement in the catalogue is granted when cloud is off', () => {
  it.each(ENTITLEMENT_KEYS)('%s is granted', (key) => {
    expect(isEntitled(DISABLED_CLOUD_CONFIG, key)).toBe(true)
  })

  // The dangerous shape: someone writes explicit denials but leaves the master
  // switch off. `enabled` must dominate, or a half-written config silently
  // gates a self-hoster.
  it.each(ENTITLEMENT_KEYS)('%s stays granted despite an explicit false override', (key) => {
    const config: CloudConfig = {
      ...DISABLED_CLOUD_CONFIG,
      entitlements: Object.fromEntries(ENTITLEMENT_KEYS.map((k) => [k, false])),
    }
    expect(isEntitled(config, key)).toBe(true)
  })

  it.each(ENTITLEMENT_KEYS)('%s stays granted on a disabled config that names a plan', (key) => {
    for (const plan of PLAN_IDS) {
      expect(isEntitled({ ...DISABLED_CLOUD_CONFIG, plan }, key)).toBe(true)
    }
  })
})

describe('the gate is a no-op end to end on an unconfigured install', () => {
  beforeEach(() => {
    vi.resetModules()
    hoisted.mockGetWorkspaceSettings.mockReset()
  })

  // Reflects the three real read outcomes a workspace with no cloud config
  // produces: no settings row at all, a row from before the migration, and a
  // row with the column present but NULL.
  const readOutcomes: Array<[string, unknown]> = [
    ['no settings row', null],
    ['a row that predates the column', { settings: { id: 'ws_1' } }],
    ['a row with cloud = NULL', { settings: { id: 'ws_1', cloud: null } }],
  ]

  it.each(readOutcomes)('requireEntitlement never throws with %s', async (_label, workspace) => {
    hoisted.mockGetWorkspaceSettings.mockResolvedValue(workspace)
    const { requireEntitlement, hasEntitlement, listEntitlements } = await import('../entitlements')
    for (const key of ENTITLEMENT_KEYS) {
      await expect(requireEntitlement(key)).resolves.toBeUndefined()
      await expect(hasEntitlement(key)).resolves.toBe(true)
    }
    expect(await listEntitlements()).toEqual(
      Object.fromEntries(ENTITLEMENT_KEYS.map((k) => [k, true]))
    )
  })

  it('a failed settings read still grants rather than 500s the request', async () => {
    hoisted.mockGetWorkspaceSettings.mockRejectedValue(new Error('database unavailable'))
    const { requireEntitlement } = await import('../entitlements')
    await expect(requireEntitlement('customDomain')).resolves.toBeUndefined()
  })
})
