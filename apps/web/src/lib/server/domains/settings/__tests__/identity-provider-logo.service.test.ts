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
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(hoisted.existingRow ? [hoisted.existingRow] : []),
      }),
    }),
    update: () => ({
      set: (patch: Record<string, unknown>) => {
        hoisted.capturedSet = patch
        return { where: () => Promise.resolve(undefined) }
      },
    }),
  },
  identityProvider: {},
  account: {},
  ssoVerifiedDomain: {},
  count: vi.fn(),
  eq: vi.fn(),
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
})

describe('saveIdentityProviderLogoKey', () => {
  it('writes the new key and invalidates the settings cache', async () => {
    const res = await saveIdentityProviderLogoKey(ID, 'idp-logos/2026/09/new.png')
    expect(res).toEqual({ success: true, key: 'idp-logos/2026/09/new.png' })
    expect(hoisted.capturedSet).toEqual({ logoKey: 'idp-logos/2026/09/new.png' })
    expect(hoisted.invalidateSettingsCache).toHaveBeenCalledOnce()
    expect(hoisted.deleteObject).not.toHaveBeenCalled()
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
  })

  it('is a no-op delete when there is no stored key, but still clears + invalidates', async () => {
    hoisted.existingRow = { logoKey: null }
    await deleteIdentityProviderLogoKey(ID)
    expect(hoisted.deleteObject).not.toHaveBeenCalled()
    expect(hoisted.capturedSet).toEqual({ logoKey: null })
    expect(hoisted.invalidateSettingsCache).toHaveBeenCalledOnce()
  })
})
