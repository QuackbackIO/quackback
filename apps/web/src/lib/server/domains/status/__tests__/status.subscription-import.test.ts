/**
 * importStatusSubscribersFromEmails: the admin CSV bulk-import contract.
 *
 * Mirrors the changelog subscriber import — it subscribes EXISTING accounts
 * only (matched by lower(email)), never creates portal accounts. This suite
 * pins the three behaviours callers rely on: known emails subscribe with the
 * `csv_import` source, unknown emails count as skipped (not an error), and
 * duplicate/differently-cased emails dedupe to a single lookup + subscribe.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSelectLimit = vi.fn()
const mockSubscribeInsert = vi.fn()

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
        return { onConflictDoUpdate: () => Promise.resolve() }
      },
    }),
  },
}))

import { importStatusSubscribersFromEmails } from '../status.subscription'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('importStatusSubscribersFromEmails', () => {
  it('subscribes known emails with the csv_import source', async () => {
    mockSelectLimit
      .mockResolvedValueOnce([{ principalId: 'pr_1' }])
      .mockResolvedValueOnce([{ principalId: 'pr_2' }])

    const result = await importStatusSubscribersFromEmails(['a@example.com', 'b@example.com'])

    expect(result).toEqual({ imported: 2, skipped: 0, total: 2 })
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

    expect(result).toEqual({ imported: 1, skipped: 1, total: 2 })
    expect(mockSubscribeInsert).toHaveBeenCalledTimes(1)
  })

  it('dedupes case-insensitively and by whitespace before looking up', async () => {
    mockSelectLimit.mockResolvedValue([{ principalId: 'pr_1' }])

    const result = await importStatusSubscribersFromEmails([
      'Dup@example.com',
      'dup@example.com',
      '  dup@example.com  ',
    ])

    expect(result).toEqual({ imported: 1, skipped: 0, total: 1 })
    expect(mockSelectLimit).toHaveBeenCalledTimes(1)
    expect(mockSubscribeInsert).toHaveBeenCalledTimes(1)
  })
})
