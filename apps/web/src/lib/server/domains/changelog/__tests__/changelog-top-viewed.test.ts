/**
 * listTopViewedChangelogs powers the admin "Top viewed" table. It ranks
 * published entries by view_count (most-viewed first) and excludes drafts,
 * scheduled entries, and soft-deleted entries — a draft has no public views
 * to rank, and a deleted entry shouldn't reappear in a ranking.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { listTopViewedChangelogs } from '../changelog.query'

const mockFindMany = vi.fn()

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: {
    query: {
      changelogEntries: { findMany: (...a: unknown[]) => mockFindMany(...a) },
    },
  },
  eq: vi.fn((col, val) => ({ kind: 'eq', col, val })),
  and: vi.fn((...args: unknown[]) => ({ kind: 'and', args })),
  isNull: vi.fn((col) => ({ kind: 'isNull', col })),
  isNotNull: vi.fn((col) => ({ kind: 'isNotNull', col })),
  lte: vi.fn((col, val) => ({ kind: 'lte', col, val })),
  desc: vi.fn((col) => ({ kind: 'desc', col })),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('listTopViewedChangelogs', () => {
  it('returns entries ranked by view count, most-viewed first', async () => {
    mockFindMany.mockResolvedValue([
      { id: 'cl_1', title: 'Dark mode', viewCount: 42, publishedAt: new Date('2026-01-03') },
      { id: 'cl_2', title: 'Faster search', viewCount: 17, publishedAt: new Date('2026-01-02') },
    ])

    const result = await listTopViewedChangelogs()

    expect(result).toEqual([
      { id: 'cl_1', title: 'Dark mode', viewCount: 42, publishedAt: new Date('2026-01-03') },
      { id: 'cl_2', title: 'Faster search', viewCount: 17, publishedAt: new Date('2026-01-02') },
    ])
  })

  it('defaults the limit to 5', async () => {
    mockFindMany.mockResolvedValue([])

    await listTopViewedChangelogs()

    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({ limit: 5 }))
  })

  it('honors an explicit limit', async () => {
    mockFindMany.mockResolvedValue([])

    await listTopViewedChangelogs({ limit: 3 })

    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({ limit: 3 }))
  })

  it('scopes to published, non-deleted entries', async () => {
    mockFindMany.mockResolvedValue([])

    await listTopViewedChangelogs()

    const call = mockFindMany.mock.calls[0][0]
    expect(call.where.kind).toBe('and')
    expect(call.where.args.map((c: { kind: string }) => c.kind)).toEqual([
      'isNull',
      'isNotNull',
      'lte',
    ])
  })
})
