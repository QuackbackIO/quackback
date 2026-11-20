/**
 * Unit tests for the provider-logo write path
 * (`saveIdentityProviderLogoKey` / `deleteIdentityProviderLogoKey`).
 *
 * The DB, S3, and settings-cache dependencies are mocked; the assertions are
 * about lifecycle — old object deleted, key written, cache invalidated.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  existingRow: null as { logoKey: string | null } | null,
  capturedSet: null as Record<string, unknown> | null,
  deleteObject: vi.fn(),
  invalidateSettingsCache: vi.fn(),
  bump: vi.fn(),
  // What happened, in order: the key write, the version bump, the commit and
  // the cache drop.
  events: [] as string[],
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(hoisted.existingRow ? [hoisted.existingRow] : []),
      }),
    }),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        update: () => ({
          set: (patch: Record<string, unknown>) => {
            hoisted.capturedSet = patch
            hoisted.events.push('write')
            return { where: () => Promise.resolve(undefined) }
          },
        }),
      }
      const result = await fn(tx)
      hoisted.events.push('commit')
      return result
    },
  },
  identityProvider: {},
  account: {},
  ssoVerifiedDomain: {},
  count: vi.fn(),
  eq: vi.fn(),
}))

vi.mock('@/lib/server/auth/config-version', () => ({
  bumpAuthConfigVersionInTx: async (tx: unknown) => {
    hoisted.bump(tx)
    hoisted.events.push('bump')
  },
}))

vi.mock('@/lib/server/storage/s3', () => ({
  deleteObject: hoisted.deleteObject,
}))

vi.mock('../settings.helpers', () => ({
  invalidateSettingsCache: hoisted.invalidateSettingsCache,
  wrapDbError: (_msg: string, err: unknown) => {
    throw err
  },
}))

vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}))

import {
  saveIdentityProviderLogoKey,
  deleteIdentityProviderLogoKey,
} from '../identity-provider-logo.service'
import type { IdentityProviderId } from '@quackback/ids'

const ID = 'idp_abc' as IdentityProviderId

beforeEach(() => {
  hoisted.existingRow = { logoKey: null }
  hoisted.capturedSet = null
  hoisted.deleteObject.mockReset()
  hoisted.invalidateSettingsCache.mockReset()
  hoisted.invalidateSettingsCache.mockImplementation(() => void hoisted.events.push('invalidate'))
  hoisted.bump.mockReset()
  hoisted.events = []
})

describe('saveIdentityProviderLogoKey', () => {
  it('writes the new key and invalidates the settings cache', async () => {
    const res = await saveIdentityProviderLogoKey(ID, 'idp-logos/2026/09/new.png')
    expect(res).toEqual({ success: true, key: 'idp-logos/2026/09/new.png' })
    expect(hoisted.capturedSet).toEqual({ logoKey: 'idp-logos/2026/09/new.png' })
    expect(hoisted.invalidateSettingsCache).toHaveBeenCalledOnce()
    expect(hoisted.deleteObject).not.toHaveBeenCalled()
  })

  it('bumps the settings row with the key, and drops the cache after the commit', async () => {
    // The bump changes the settings row's version, so a settings read that
    // overlapped the write refuses to cache the old sign-in button.
    await saveIdentityProviderLogoKey(ID, 'idp-logos/2026/09/new.png')
    expect(hoisted.events).toEqual(['write', 'bump', 'commit', 'invalidate'])
  })

  it('deletes the previous object when replacing an existing logo', async () => {
    hoisted.existingRow = { logoKey: 'idp-logos/2026/08/old.png' }
    await saveIdentityProviderLogoKey(ID, 'idp-logos/2026/09/new.png')
    expect(hoisted.deleteObject).toHaveBeenCalledWith('idp-logos/2026/08/old.png')
  })

  it('does not delete when the key is unchanged', async () => {
    hoisted.existingRow = { logoKey: 'idp-logos/same.png' }
    await saveIdentityProviderLogoKey(ID, 'idp-logos/same.png')
    expect(hoisted.deleteObject).not.toHaveBeenCalled()
  })

  it('still writes the key when deleting the old object throws', async () => {
    hoisted.existingRow = { logoKey: 'idp-logos/old.png' }
    hoisted.deleteObject.mockRejectedValueOnce(new Error('s3 down'))
    const res = await saveIdentityProviderLogoKey(ID, 'idp-logos/new.png')
    expect(res).toEqual({ success: true, key: 'idp-logos/new.png' })
    expect(hoisted.capturedSet).toEqual({ logoKey: 'idp-logos/new.png' })
  })

  it('throws when the provider does not exist', async () => {
    hoisted.existingRow = null
    await expect(saveIdentityProviderLogoKey(ID, 'k')).rejects.toThrow()
    expect(hoisted.invalidateSettingsCache).not.toHaveBeenCalled()
  })
})

describe('deleteIdentityProviderLogoKey', () => {
  it('nulls the key, removes the object, and invalidates the cache', async () => {
    hoisted.existingRow = { logoKey: 'idp-logos/2026/09/x.png' }
    const res = await deleteIdentityProviderLogoKey(ID)
    expect(res).toEqual({ success: true })
    expect(hoisted.deleteObject).toHaveBeenCalledWith('idp-logos/2026/09/x.png')
    expect(hoisted.capturedSet).toEqual({ logoKey: null })
    expect(hoisted.invalidateSettingsCache).toHaveBeenCalledOnce()
    expect(hoisted.events).toEqual(['write', 'bump', 'commit', 'invalidate'])
  })

  it('is a no-op delete when there is no stored key, but still clears + invalidates', async () => {
    hoisted.existingRow = { logoKey: null }
    await deleteIdentityProviderLogoKey(ID)
    expect(hoisted.deleteObject).not.toHaveBeenCalled()
    expect(hoisted.capturedSet).toEqual({ logoKey: null })
    expect(hoisted.invalidateSettingsCache).toHaveBeenCalledOnce()
  })
})
