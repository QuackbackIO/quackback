/**
 * `writeCloudConfig` is the single mutation seam, and the place the two-writer
 * contract is actually enforced: the declarative config file claims paths in
 * `settings.managed_field_paths`, and any other writer is refused those paths.
 *
 * This file covers the *decisions* — validation, the managed-path refusal, the
 * shape of the merged block. The concurrency property those decisions sit
 * inside (the row lock that makes two writers safe) cannot be expressed with a
 * fake executor and is proven against a real database in
 * `cloud-concurrency.db.test.ts`.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { ForbiddenError, ValidationError } from '@/lib/shared/errors'

interface StoredRow {
  id: string
  cloud: Record<string, unknown> | null
  cloudRevision: number
  managedFieldPaths: string[]
}

const hoisted = vi.hoisted(() => ({
  state: {
    row: null as null | {
      id: string
      cloud: Record<string, unknown> | null
      cloudRevision: number
      managedFieldPaths: string[]
    },
    written: undefined as unknown,
    locked: false,
    authBumped: 0,
  },
  mockInvalidate: vi.fn(async () => {}),
}))

/**
 * A fake transaction shaped like the real one.
 *
 * `locked` records that the read went through `.for('update')`. Asserting it
 * is not a substitute for the real concurrency test — a fake cannot contend —
 * but it does catch the specific regression of someone "simplifying" the read
 * back to an unlocked select while the real test is skipped for want of a
 * database.
 */
vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        select: () => ({
          from: () => ({
            limit: () => ({
              for: (mode: string) => {
                hoisted.state.locked = mode === 'update'
                return Promise.resolve(hoisted.state.row ? [hoisted.state.row] : [])
              },
            }),
          }),
        }),
        update: () => ({
          set: (values: unknown) => {
            // The auth-config bump is a second `update().set()` with no
            // `where`; distinguish it so it does not overwrite the capture.
            if (values && typeof values === 'object' && 'cloud' in values) {
              hoisted.state.written = values
              return { where: async () => {} }
            }
            hoisted.state.authBumped++
            return Promise.resolve() as unknown as { where: () => Promise<void> }
          },
        }),
      }
      return await callback(tx)
    },
  },
}))

vi.mock('../../settings.helpers', () => ({
  invalidateSettingsCache: hoisted.mockInvalidate,
}))

import { writeCloudConfig } from '../cloud.service'

function row(overrides: Partial<StoredRow> = {}): StoredRow {
  return { id: 'ws_1', cloud: null, cloudRevision: 0, managedFieldPaths: [], ...overrides }
}

function written(): { cloud: Record<string, unknown>; cloudRevision: number } {
  return hoisted.state.written as { cloud: Record<string, unknown>; cloudRevision: number }
}

beforeEach(() => {
  hoisted.state.row = row()
  hoisted.state.written = undefined
  hoisted.state.locked = false
  hoisted.state.authBumped = 0
  hoisted.mockInvalidate.mockClear()
})

describe('writeCloudConfig', () => {
  it('writes a merged block, bumps the revision, and busts the settings cache', async () => {
    const result = await writeCloudConfig(
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
    expect(written().cloudRevision).toBe(1)
    expect(result).toEqual({ changed: true, revision: 1 })
    expect(hoisted.mockInvalidate).toHaveBeenCalledOnce()
    expect(hoisted.state.authBumped).toBe(1)
  })

  it('reads the row under a lock', async () => {
    await writeCloudConfig({ enabled: true, plan: 'pro' }, { writer: 'config' })
    expect(hoisted.state.locked).toBe(true)
  })

  it('does nothing at all for an empty patch', async () => {
    const result = await writeCloudConfig({}, { writer: 'billing' })
    expect(result.changed).toBe(false)
    expect(hoisted.state.written).toBeUndefined()
    expect(hoisted.state.locked).toBe(false)
  })

  it('skips the write when the merge changes nothing substantive', async () => {
    // Idempotence: the reconciler polls every 30s and the provider redelivers.
    // Only `updatedAt` would differ here, and that must not count as a change.
    hoisted.state.row = row({
      cloud: {
        enabled: true,
        plan: 'pro',
        entitlements: {},
        billing: {},
        source: 'config',
        updatedAt: '2020-01-01T00:00:00.000Z',
      },
      cloudRevision: 7,
    })
    const result = await writeCloudConfig({ enabled: true, plan: 'pro' }, { writer: 'config' })
    expect(result).toEqual({ changed: false, revision: 7 })
    expect(hoisted.state.written).toBeUndefined()
    expect(hoisted.mockInvalidate).not.toHaveBeenCalled()
    expect(hoisted.state.authBumped).toBe(0)
  })

  it('refuses a billing write to a path the config file has claimed', async () => {
    hoisted.state.row = row({ managedFieldPaths: ['cloud.enabled', 'cloud.plan'] })
    await expect(writeCloudConfig({ plan: 'free' }, { writer: 'billing' })).rejects.toThrow(
      ForbiddenError
    )
    expect(hoisted.state.written).toBeUndefined()
  })

  it('lets a billing write proceed on paths the config file left alone', async () => {
    // The file pinned the plan; billing may still record which subscription
    // the workspace is on. This is the whole point of leaf-level managed paths.
    hoisted.state.row = row({
      managedFieldPaths: ['cloud.enabled', 'cloud.plan'],
      cloud: { enabled: true, plan: 'scale' },
      cloudRevision: 3,
    })
    await writeCloudConfig(
      { billing: { provider: 'acme', subscriptionRef: 'sub_1' } },
      { writer: 'billing', now: new Date('2026-08-08T00:00:00.000Z') }
    )
    expect(written().cloud).toEqual({
      enabled: true,
      plan: 'scale',
      entitlements: {},
      billing: { provider: 'acme', subscriptionRef: 'sub_1' },
      source: 'billing',
      updatedAt: '2026-08-08T00:00:00.000Z',
    })
    expect(written().cloudRevision).toBe(4)
  })

  it('never refuses the config writer its own claimed paths', async () => {
    hoisted.state.row = row({ managedFieldPaths: ['cloud.enabled', 'cloud.plan'] })
    await expect(
      writeCloudConfig({ enabled: true, plan: 'scale' }, { writer: 'config' })
    ).resolves.toEqual({ changed: true, revision: 1 })
  })

  it('honours a whole-block lock if one is ever written', async () => {
    hoisted.state.row = row({ managedFieldPaths: ['cloud'] })
    await expect(writeCloudConfig({ billing: {} }, { writer: 'billing' })).rejects.toThrow(
      ForbiddenError
    )
  })

  it('rejects an unknown plan before touching the row', async () => {
    await expect(
      writeCloudConfig({ plan: 'platinum' as never }, { writer: 'billing' })
    ).rejects.toThrow(ValidationError)
    expect(hoisted.state.locked).toBe(false)
  })

  it('rejects a trial on an unknown plan before touching the row', async () => {
    // The resolver reads a trial it cannot rank as no trial at all, so storing
    // one would be a workspace whose trial silently never happened.
    await expect(
      writeCloudConfig(
        {
          trial: {
            plan: 'platinum' as never,
            startedAt: '2026-03-01T00:00:00.000Z',
            endsAt: '2026-03-15T00:00:00.000Z',
          },
        },
        { writer: 'billing' }
      )
    ).rejects.toThrow(ValidationError)
    expect(hoisted.state.locked).toBe(false)
  })

  it('writes a trial the config file has not claimed', async () => {
    // Guards the specific silent failure of a patch key with no managed path:
    // `cloudPatchPaths` would report nothing to write and the seam would
    // return "unchanged" without ever opening a transaction.
    hoisted.state.row = row({ cloud: { enabled: true, plan: 'free' } })
    const trial = {
      plan: 'pro' as const,
      startedAt: '2026-03-01T00:00:00.000Z',
      endsAt: '2026-03-15T00:00:00.000Z',
    }
    const result = await writeCloudConfig(
      { trial },
      { writer: 'billing', now: new Date('2026-03-01T00:00:00.000Z') }
    )
    expect(result.changed).toBe(true)
    expect(written().cloud).toEqual({
      enabled: true,
      plan: 'free',
      entitlements: {},
      billing: {},
      trial,
      source: 'billing',
      updatedAt: '2026-03-01T00:00:00.000Z',
    })
  })

  it('rejects an unknown entitlement key', async () => {
    await expect(
      writeCloudConfig({ entitlements: { timeTravel: true } as never }, { writer: 'billing' })
    ).rejects.toThrow(ValidationError)
  })
})
