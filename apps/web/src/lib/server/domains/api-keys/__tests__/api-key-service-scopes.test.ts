/**
 * createApiKey scope handling: validates the requested scopes against the
 * vocabulary, stores them as a JSON array, and returns the parsed scopes on
 * the created key. Omitted scopes store NULL (legacy full-authority key).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PrincipalId } from '@quackback/ids'

const mockInsertValues = vi.fn()
const mockFindFirst = vi.fn()

vi.mock('@/lib/server/db', async (importOriginal) => ({
  // Spread the real db module so tables/operators stay current; override only what this suite drives.
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    insert: () => ({
      values: (v: unknown) => {
        mockInsertValues(v)
        return {
          returning: () =>
            Promise.resolve([
              {
                id: 'api_key_new',
                name: 'k',
                keyHash: 'h',
                keyPrefix: 'qb_x',
                createdById: 'principal_creator',
                principalId: 'principal_svc',
                lastUsedAt: null,
                expiresAt: null,
                createdAt: new Date(),
                revokedAt: null,
                scopes: (mockInsertValues.mock.calls.at(-1)?.[0] as { scopes: string | null })
                  .scopes,
              },
            ]),
        }
      },
    }),
    query: { principal: { findFirst: (...a: unknown[]) => mockFindFirst(...a) } },
  },
  eq: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
}))

vi.mock('@/lib/server/domains/principals/principal.service', () => ({
  createServicePrincipal: vi.fn().mockResolvedValue({ id: 'principal_svc' }),
}))

vi.mock('@/lib/server/domains/principals/principal.factory', () => ({
  setPrincipalRole: vi.fn(),
  updatePrincipalFields: vi.fn().mockResolvedValue(undefined),
  syncPrincipalProfileById: vi.fn(),
}))

const { createApiKey } = await import('../api-key.service')
const { ValidationError } = await import('@/lib/shared/errors')

const CREATOR = 'principal_creator' as PrincipalId

beforeEach(() => {
  vi.clearAllMocks()
  mockFindFirst.mockResolvedValue({ role: 'admin' })
})

describe('createApiKey scopes', () => {
  it('stores NULL when no scopes are provided (legacy full-authority key)', async () => {
    const result = await createApiKey({ name: 'CI key' }, CREATOR)
    expect(mockInsertValues.mock.calls[0][0].scopes).toBeNull()
    expect(result.apiKey.scopes).toBeNull()
  })

  it('stores the requested scopes as JSON and returns them parsed', async () => {
    const result = await createApiKey(
      { name: 'Read-only key', scopes: ['read:feedback', 'read:article'] },
      CREATOR
    )
    expect(JSON.parse(mockInsertValues.mock.calls[0][0].scopes)).toEqual([
      'read:feedback',
      'read:article',
    ])
    expect(result.apiKey.scopes).toEqual(['read:feedback', 'read:article'])
  })

  it('dedupes repeated scopes', async () => {
    await createApiKey(
      { name: 'k', scopes: ['read:feedback', 'read:feedback', 'write:feedback'] },
      CREATOR
    )
    expect(JSON.parse(mockInsertValues.mock.calls[0][0].scopes)).toEqual([
      'read:feedback',
      'write:feedback',
    ])
  })

  it('rejects scopes outside the vocabulary', async () => {
    await expect(
      createApiKey({ name: 'k', scopes: ['read:everything' as never, 'read:feedback'] }, CREATOR)
    ).rejects.toThrow(ValidationError)
    expect(mockInsertValues).not.toHaveBeenCalled()
  })

  it('rejects an empty scope list', async () => {
    await expect(createApiKey({ name: 'k', scopes: [] }, CREATOR)).rejects.toThrow(
      'Select at least one scope'
    )
    expect(mockInsertValues).not.toHaveBeenCalled()
  })
})
