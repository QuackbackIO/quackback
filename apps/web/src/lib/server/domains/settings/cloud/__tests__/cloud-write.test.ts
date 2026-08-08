/**
 * `writeCloudConfig` is the single mutation seam, and the place the two-writer
 * contract is actually enforced: the declarative config file claims paths in
 * `settings.managed_field_paths`, and any other writer is refused those paths.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { ForbiddenError, ValidationError } from '@/lib/shared/errors'

const hoisted = vi.hoisted(() => ({
  mockRequireSettings: vi.fn(),
  mockInvalidate: vi.fn(async () => {}),
  captured: { value: undefined as unknown },
}))

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    update: () => ({
      set: (values: unknown) => {
        hoisted.captured.value = values
        return { where: async () => {} }
      },
    }),
  },
}))

vi.mock('../../settings.helpers', () => ({
  requireSettings: hoisted.mockRequireSettings,
  invalidateSettingsCache: hoisted.mockInvalidate,
}))

import { writeCloudConfig } from '../cloud.service'

function row(overrides: Record<string, unknown> = {}) {
  return { id: 'ws_1', cloud: null, managedFieldPaths: [], ...overrides }
}

function written(): { cloud: Record<string, unknown> } {
  return hoisted.captured.value as { cloud: Record<string, unknown> }
}

beforeEach(() => {
  hoisted.mockRequireSettings.mockReset()
  hoisted.mockInvalidate.mockClear()
  hoisted.captured.value = undefined
})

describe('writeCloudConfig', () => {
  it('writes a merged block and busts the settings cache', async () => {
    hoisted.mockRequireSettings.mockResolvedValue(row())
    await writeCloudConfig(
      { enabled: true, plan: 'pro' },
      { writer: 'config', now: new Date('2026-08-08T00:00:00.000Z') }
    )
    expect(written().cloud).toEqual({
      enabled: true,
      plan: 'pro',
      entitlements: {},
      billing: {},
      source: 'config',
      updatedAt: '2026-08-08T00:00:00.000Z',
    })
    expect(hoisted.mockInvalidate).toHaveBeenCalledOnce()
  })

  it('does nothing at all for an empty patch', async () => {
    hoisted.mockRequireSettings.mockResolvedValue(row())
    await writeCloudConfig({}, { writer: 'billing' })
    expect(hoisted.mockRequireSettings).not.toHaveBeenCalled()
    expect(hoisted.captured.value).toBeUndefined()
  })

  it('refuses a billing write to a path the config file has claimed', async () => {
    hoisted.mockRequireSettings.mockResolvedValue(
      row({ managedFieldPaths: ['cloud.enabled', 'cloud.plan'] })
    )
    await expect(writeCloudConfig({ plan: 'free' }, { writer: 'billing' })).rejects.toThrow(
      ForbiddenError
    )
    expect(hoisted.captured.value).toBeUndefined()
  })

  it('lets a billing write proceed on paths the config file left alone', async () => {
    // The file pinned the plan; billing may still record which subscription
    // the workspace is on. This is the whole point of leaf-level managed paths.
    hoisted.mockRequireSettings.mockResolvedValue(
      row({
        managedFieldPaths: ['cloud.enabled', 'cloud.plan'],
        cloud: { enabled: true, plan: 'business' },
      })
    )
    await writeCloudConfig(
      { billing: { provider: 'acme', subscriptionRef: 'sub_1' } },
      { writer: 'billing', now: new Date('2026-08-08T00:00:00.000Z') }
    )
    expect(written().cloud).toEqual({
      enabled: true,
      plan: 'business',
      entitlements: {},
      billing: { provider: 'acme', subscriptionRef: 'sub_1' },
      source: 'billing',
      updatedAt: '2026-08-08T00:00:00.000Z',
    })
  })

  it('never refuses the config writer its own claimed paths', async () => {
    hoisted.mockRequireSettings.mockResolvedValue(
      row({ managedFieldPaths: ['cloud.enabled', 'cloud.plan'] })
    )
    await expect(
      writeCloudConfig({ enabled: true, plan: 'enterprise' }, { writer: 'config' })
    ).resolves.toBeUndefined()
  })

  it('honours a whole-block lock if one is ever written', async () => {
    hoisted.mockRequireSettings.mockResolvedValue(row({ managedFieldPaths: ['cloud'] }))
    await expect(writeCloudConfig({ billing: {} }, { writer: 'billing' })).rejects.toThrow(
      ForbiddenError
    )
  })

  it('rejects an unknown plan before touching the row', async () => {
    hoisted.mockRequireSettings.mockResolvedValue(row())
    await expect(
      writeCloudConfig({ plan: 'platinum' as never }, { writer: 'billing' })
    ).rejects.toThrow(ValidationError)
    expect(hoisted.mockRequireSettings).not.toHaveBeenCalled()
  })

  it('rejects an unknown entitlement key', async () => {
    hoisted.mockRequireSettings.mockResolvedValue(row())
    await expect(
      writeCloudConfig({ entitlements: { timeTravel: true } as never }, { writer: 'billing' })
    ).rejects.toThrow(ValidationError)
  })
})
