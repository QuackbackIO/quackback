/**
 * Two writers, one column. These tests pin the property that keeps the config
 * reconciler and a future billing module from overwriting each other: every
 * write is a merge of the sub-blocks it declares, never a replacement of the
 * whole block.
 */
import { describe, expect, it } from 'vitest'
import type { StoredCloudConfig } from '@/lib/shared/db-types'
import {
  CLOUD_MANAGED_PATHS,
  cloudConfigEquivalent,
  cloudPatchPaths,
  mergeCloudConfig,
} from '../cloud.merge'

const NOW = new Date('2026-08-08T12:00:00.000Z')

function configWritten(): StoredCloudConfig {
  return mergeCloudConfig(
    null,
    { enabled: true, plan: 'pro', entitlements: { sso: true } },
    { writer: 'config', now: NOW }
  )
}

describe('mergeCloudConfig', () => {
  it('seeds a block from nothing', () => {
    expect(configWritten()).toEqual({
      enabled: true,
      plan: 'pro',
      entitlements: { sso: true },
      billing: {},
      source: 'config',
      updatedAt: NOW.toISOString(),
    })
  })

  it('defaults to disabled when a patch does not say otherwise', () => {
    const merged = mergeCloudConfig(null, { billing: { provider: 'acme' } }, { writer: 'billing' })
    expect(merged.enabled).toBe(false)
    expect(merged.plan).toBeNull()
  })

  it('a billing write preserves the plan the config writer set', () => {
    const after = mergeCloudConfig(
      configWritten(),
      { billing: { provider: 'acme', customerRef: 'cus_1', subscriptionRef: 'sub_1' } },
      { writer: 'billing', now: NOW }
    )
    expect(after.plan).toBe('pro')
    expect(after.enabled).toBe(true)
    expect(after.entitlements).toEqual({ sso: true })
    expect(after.billing).toEqual({
      provider: 'acme',
      customerRef: 'cus_1',
      subscriptionRef: 'sub_1',
    })
  })

  it('a config write preserves billing references the billing writer set', () => {
    const withBilling = mergeCloudConfig(
      configWritten(),
      { billing: { provider: 'acme', subscriptionRef: 'sub_1' } },
      { writer: 'billing', now: NOW }
    )
    const after = mergeCloudConfig(
      withBilling,
      { enabled: true, plan: 'scale' },
      { writer: 'config', now: NOW }
    )
    expect(after.plan).toBe('scale')
    expect(after.billing).toEqual({ provider: 'acme', subscriptionRef: 'sub_1' })
    expect(after.entitlements).toEqual({ sso: true })
  })

  it('merges entitlement overrides key by key rather than replacing the map', () => {
    const after = mergeCloudConfig(
      configWritten(),
      { entitlements: { auditLog: true } },
      { writer: 'billing', now: NOW }
    )
    expect(after.entitlements).toEqual({ sso: true, auditLog: true })
  })

  it('records who wrote last and when, so a downgrade is explicable', () => {
    const after = mergeCloudConfig(
      configWritten(),
      { plan: 'free' },
      { writer: 'billing', now: new Date('2026-09-01T00:00:00.000Z') }
    )
    expect(after.source).toBe('billing')
    expect(after.updatedAt).toBe('2026-09-01T00:00:00.000Z')
  })

  it('distinguishes "clear the plan" from "do not touch the plan"', () => {
    expect(mergeCloudConfig(configWritten(), { plan: null }, { writer: 'config' }).plan).toBeNull()
    expect(mergeCloudConfig(configWritten(), { enabled: false }, { writer: 'config' }).plan).toBe(
      'pro'
    )
  })
})

describe('cloudConfigEquivalent', () => {
  it('ignores the write stamp so a steady-state reconcile is a no-op', () => {
    const a = mergeCloudConfig(null, { enabled: true, plan: 'pro' }, { writer: 'config', now: NOW })
    const b = mergeCloudConfig(
      null,
      { enabled: true, plan: 'pro' },
      { writer: 'billing', now: new Date('2027-01-01T00:00:00.000Z') }
    )
    expect(cloudConfigEquivalent(a, b)).toBe(true)
  })

  it('sees a substantive change at any depth', () => {
    const base = mergeCloudConfig(
      null,
      { enabled: true, plan: 'pro', entitlements: { sso: true }, billing: { provider: 'acme' } },
      { writer: 'config', now: NOW }
    )
    expect(cloudConfigEquivalent(base, { ...base, plan: 'scale' })).toBe(false)
    // Nested keys must not be flattened away by the comparison — the reason
    // stableStringify recurses instead of using a JSON.stringify replacer.
    expect(cloudConfigEquivalent(base, { ...base, entitlements: { sso: false } })).toBe(false)
    expect(cloudConfigEquivalent(base, { ...base, billing: { provider: 'other' } })).toBe(false)
  })

  it('is insensitive to key ordering', () => {
    const a: StoredCloudConfig = {
      enabled: true,
      plan: 'pro',
      entitlements: { sso: true, apiAccess: false },
    }
    const b: StoredCloudConfig = {
      entitlements: { apiAccess: false, sso: true },
      plan: 'pro',
      enabled: true,
    }
    expect(cloudConfigEquivalent(a, b)).toBe(true)
  })

  it('treats null and absent alike', () => {
    expect(cloudConfigEquivalent(null, undefined)).toBe(true)
    expect(cloudConfigEquivalent(null, { enabled: false })).toBe(false)
  })
})

describe('cloudPatchPaths', () => {
  it('reports only the leaf paths a patch touches', () => {
    expect(cloudPatchPaths({ plan: 'pro' })).toEqual([CLOUD_MANAGED_PATHS.plan])
    expect(cloudPatchPaths({ billing: { provider: 'acme' } })).toEqual([
      CLOUD_MANAGED_PATHS.billing,
    ])
    expect(cloudPatchPaths({})).toEqual([])
  })

  it('treats an explicit null as a touch', () => {
    expect(cloudPatchPaths({ plan: null })).toEqual([CLOUD_MANAGED_PATHS.plan])
  })

  it('never claims the whole block, so the two writers can share it', () => {
    for (const path of Object.values(CLOUD_MANAGED_PATHS)) {
      expect(path.startsWith('cloud.')).toBe(true)
      expect(path).not.toBe('cloud')
    }
  })
})
