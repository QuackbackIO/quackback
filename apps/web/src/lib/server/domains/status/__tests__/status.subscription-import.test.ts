/**
 * importStatusSubscribersFromEmails: the admin CSV bulk-import contract.
 *
 * Mirrors the changelog subscriber import — it subscribes EXISTING accounts
 * only (matched by lower(email)), never creates portal accounts. This suite
 * pins the behaviours callers rely on: known emails subscribe with the
 * `csv_import` source, unknown emails count as skipped (not an error), people
 * who unsubscribed are counted apart and left alone, and
 * duplicate/differently-cased emails dedupe to a single lookup + subscribe.
 * (The opt-out guard itself is SQL; status.subscription.db.test.ts runs it.)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSelectLimit = vi.fn()
const mockSubscribeInsert = vi.fn()
// Rows the upsert returns: one when the person is (now) subscribed, none
// when the conflict update was skipped because they had opted out.
const mockUpsertReturning = vi.fn()

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            limit: (...args: unknown[]) => mockSelectLimit(...args),
          }),
        }),
      }),
    }),
    insert: () => ({
      values: (arg: unknown) => {
        mockSubscribeInsert(arg)
        return {
          onConflictDoUpdate: () => ({ returning: () => mockUpsertReturning() }),
        }
      },
    }),
  },
}))

import { importStatusSubscribersFromEmails } from '../status.subscription'

beforeEach(() => {
  vi.clearAllMocks()
  mockUpsertReturning.mockResolvedValue([{ id: 'status_sub_1' }])
})

describe('importStatusSubscribersFromEmails', () => {
  it('subscribes known emails with the csv_import source', async () => {
    mockSelectLimit
      .mockResolvedValueOnce([{ principalId: 'pr_1' }])
      .mockResolvedValueOnce([{ principalId: 'pr_2' }])

    const result = await importStatusSubscribersFromEmails(['a@example.com', 'b@example.com'])

    expect(result).toEqual({ imported: 2, skipped: 0, optedOut: 0, total: 2 })
    expect(mockSubscribeInsert).toHaveBeenCalledTimes(2)
    expect(mockSubscribeInsert).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'page', source: 'csv_import', componentIds: [] })
    )
  })

  it('counts unmatched emails as skipped without subscribing them', async () => {
    mockSelectLimit.mockResolvedValueOnce([{ principalId: 'pr_1' }]).mockResolvedValueOnce([])

    const result = await importStatusSubscribersFromEmails([
      'known@example.com',
      'ghost@example.com',
    ])

    expect(result).toEqual({ imported: 1, skipped: 1, optedOut: 0, total: 2 })
    expect(mockSubscribeInsert).toHaveBeenCalledTimes(1)
  })

  it('counts people who unsubscribed apart from unmatched emails', async () => {
    mockSelectLimit
      .mockResolvedValueOnce([{ principalId: 'pr_1' }])
      .mockResolvedValueOnce([{ principalId: 'pr_2' }])
      .mockResolvedValueOnce([])
    mockUpsertReturning.mockResolvedValueOnce([{ id: 'status_sub_1' }]).mockResolvedValueOnce([])

    const result = await importStatusSubscribersFromEmails([
      'known@example.com',
      'optedout@example.com',
      'ghost@example.com',
    ])

    expect(result).toEqual({ imported: 1, skipped: 1, optedOut: 1, total: 3 })
  })

  it('dedupes case-insensitively and by whitespace before looking up', async () => {
    mockSelectLimit.mockResolvedValue([{ principalId: 'pr_1' }])

    const result = await importStatusSubscribersFromEmails([
      'Dup@example.com',
      'dup@example.com',
      '  dup@example.com  ',
    ])

    expect(result).toEqual({ imported: 1, skipped: 0, optedOut: 0, total: 1 })
    expect(mockSelectLimit).toHaveBeenCalledTimes(1)
    expect(mockSubscribeInsert).toHaveBeenCalledTimes(1)
  })
})
